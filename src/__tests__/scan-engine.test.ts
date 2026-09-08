import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitUnverified, decide, runScan, type EngineManifest, type ScanContext } from "@/lib/scan-engine";
import { parseQr } from "@/lib/qr-v3";
import { sha256Hex, ticketHash } from "@/lib/hash";
import type { LookupResult, ManifestRow } from "@/lib/manifest";
import { makeKeypair, makeV3Qr, TOKEN, TOKEN_2 } from "./helpers/qr";

const kp = makeKeypair();
const NOW = Date.parse("2026-09-05T18:00:00.000Z");
const manifest: EngineManifest = {
  eventId: "42",
  publicKey: kp.pubB64,
  window: { opensAt: "2026-09-05T15:00:00.000Z", closesAt: "2026-09-06T00:00:00.000Z" },
  allowedTicketTypeIds: [],
  ticketTypes: [
    { id: 1, name: "GA", seated: false, sectionNum: null },
    { id: 2, name: "VIP", seated: true, sectionNum: 4 },
  ],
  ageMs: 60_000,
};
const code = makeV3Qr({ eventId: "42", tokenId: TOKEN, qrv: 1, priv: kp.priv });
const h = ticketHash(TOKEN);

const rowOf = (over: Partial<ManifestRow> = {}): ManifestRow => ({ h, tt: 1, v: 1, s: "valid", n: "Alice", gen: 1, ...over });
const lookupOf = (entry: ManifestRow | null, status: LookupResult["effectiveStatus"] = entry ? "valid" : "missing"): LookupResult => ({
  entry,
  meta: null,
  effectiveStatus: status,
  ageMs: 60_000,
});

const base = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  parsed: parseQr(code),
  payloadHash: sha256Hex(code),
  manifest,
  lookup: lookupOf(rowOf()),
  nowMs: NOW,
  deviceId: "dev-1",
  idbAvailable: true,
  offlineEnabled: true,
  recent: null,
  ...over,
});

describe("decide — offline rulebook", () => {
  it("0 same code within the cooldown → ignore", () => {
    expect(decide(base({ recent: { hash: sha256Hex(code), at: NOW - 1000 } }))).toEqual({ plan: "ignore" });
    expect(decide(base({ recent: { hash: sha256Hex(code), at: NOW - 5000 } })).plan).toBe("admit");
  });
  it("1 not a ticket → NOT_A_TICKET", () => {
    expect(decide(base({ parsed: parseQr("WIFI:S:x;;") }))).toEqual({ plan: "invalid", code: "NOT_A_TICKET" });
  });
  it("2 legacy v2 → unverifiable(legacy_format)", () => {
    expect(decide(base({ parsed: parseQr(Buffer.alloc(80, 1).toString("base64")) }))).toEqual({ plan: "unverifiable", reason: "legacy_format" });
  });
  it("3/4 offline disabled, no storage, no manifest → unverifiable", () => {
    expect(decide(base({ offlineEnabled: false }))).toEqual({ plan: "unverifiable", reason: "offline_disabled" });
    expect(decide(base({ idbAvailable: false }))).toEqual({ plan: "unverifiable", reason: "idb_unavailable" });
    expect(decide(base({ manifest: null }))).toEqual({ plan: "unverifiable", reason: "no_manifest" });
  });
  it("5 other event → WRONG_EVENT; 6 bad signature → BAD_SIGNATURE", () => {
    expect(decide(base({ manifest: { ...manifest, eventId: "43" } }))).toEqual({ plan: "invalid", code: "WRONG_EVENT" });
    expect(decide(base({ manifest: { ...manifest, publicKey: makeKeypair().pubB64 } }))).toEqual({ plan: "invalid", code: "BAD_SIGNATURE" });
  });
  it("7 authentic but not in the manifest → operator choice", () => {
    expect(decide(base({ lookup: lookupOf(null) }))).toMatchObject({ plan: "authentic_not_in_manifest", h, tokenId: TOKEN });
  });
  it("8 qrv below the manifest → STALE_QR; above → treated as not-in-data", () => {
    expect(decide(base({ lookup: lookupOf(rowOf({ v: 2 })) }))).toEqual({ plan: "invalid", code: "STALE_QR" });
    const newer = makeV3Qr({ eventId: "42", tokenId: TOKEN, qrv: 5, priv: kp.priv });
    expect(decide(base({ parsed: parseQr(newer), payloadHash: sha256Hex(newer) })).plan).toBe("authentic_not_in_manifest");
  });
  it("9 used / used_local → already_used, sameDevice only for this device's local mark", () => {
    expect(decide(base({ lookup: lookupOf(rowOf({ s: "used" }), "used") }))).toMatchObject({ plan: "already_used", sameDevice: false, usedAt: null });
    expect(decide(base({ lookup: lookupOf(rowOf({ localUsedAt: "t", localDeviceId: "dev-1" }), "used_local") }))).toMatchObject({ plan: "already_used", sameDevice: true, usedAt: "t" });
    expect(decide(base({ lookup: lookupOf(rowOf({ localUsedAt: "t", localDeviceId: "dev-2" }), "used_local") }))).toMatchObject({ plan: "already_used", sameDevice: false });
  });
  it("10 ticket type not allowed here → wrong_scanner", () => {
    expect(decide(base({ manifest: { ...manifest, allowedTicketTypeIds: [2] } }))).toMatchObject({ plan: "wrong_scanner", ticketTypeId: 1, ticket: { ticketTypeName: "GA" } });
  });
  it("11 outside the (corrected-clock) window → outside_window, not consumed", () => {
    expect(decide(base({ nowMs: Date.parse("2026-09-05T14:00:00.000Z") }))).toMatchObject({ plan: "outside_window", reason: "too_early" });
    expect(decide(base({ nowMs: Date.parse("2026-09-06T01:00:00.000Z") }))).toMatchObject({ plan: "outside_window", reason: "too_late" });
  });
  it("12 otherwise → admit with the ticket summary", () => {
    expect(decide(base())).toEqual({ plan: "admit", h, ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, tokenId: TOKEN }, manifestAgeMs: 60_000 });
  });
});

describe("runScan", () => {
  const rows = new Map<string, ManifestRow>();
  const enqueued: unknown[] = [];
  const marked: unknown[] = [];
  const post = vi.fn();
  const onAuthRequired = vi.fn();
  const onRateLimited = vi.fn();
  let online = true;

  const ctx = (): ScanContext => ({
    deviceId: "dev-1",
    nowMs: () => NOW,
    isOnline: () => online,
    browserOnline: () => true,
    idbAvailable: true,
    offlineEnabled: true,
    manifest: {
      snapshot: async () => manifest,
      lookup: async (hash) => {
        const entry = rows.get(hash) ?? null;
        return lookupOf(entry, entry ? (entry.localUsedAt ? "used_local" : entry.s === "used" ? "used" : "valid") : "missing");
      },
      markUsedLocally: async (hash, mark) => {
        marked.push({ hash, mark });
        const e = rows.get(hash);
        if (e) rows.set(hash, { ...e, localUsedAt: mark.at, localDeviceId: mark.deviceId, localScanId: mark.scanId });
      },
    },
    post,
    queue: { enqueue: async (input) => void enqueued.push(input) },
    onAuthRequired,
    onRateLimited,
    onNetworkOk: () => {},
    onNetworkFail: () => {},
    recent: () => null,
  });

  const serverSuccess = (scanId: string) => ({
    status: 200,
    data: {
      result: "success",
      scanLogId: "log-1",
      undoableUntil: "2026-09-05T18:05:00.000Z",
      ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, nftId: TOKEN, tokenId: TOKEN, seatInfo: null },
      serverTime: "2026-09-05T18:00:00.000Z",
      _scanId: scanId,
    },
  });

  beforeEach(() => {
    rows.clear();
    rows.set(h, rowOf());
    enqueued.length = 0;
    marked.length = 0;
    post.mockReset();
    onAuthRequired.mockReset();
    onRateLimited.mockReset();
    online = true;
  });

  it("online: posts once with source=live and returns the server verdict; nothing is queued", async () => {
    post.mockImplementation(async (body: { scanId: string }) => serverSuccess(body.scanId));
    const out = await runScan(ctx(), code);
    expect(out).toMatchObject({ kind: "success", server: { scanLogId: "log-1" } });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ payload: code, deviceId: "dev-1", source: "live" });
    expect(enqueued).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  it("timeout → offline fallback with the SAME scanId (queued as live_fallback, marked used locally)", async () => {
    post.mockResolvedValue({ status: 0, data: null, timedOut: true });
    const out = await runScan(ctx(), code);
    expect(out.kind).toBe("success_offline");
    const scanId = post.mock.calls[0][0].scanId;
    expect(enqueued[0]).toMatchObject({ scanId, kind: "live_fallback", localVerdict: "success", ticketHint: { h, ownerName: "Alice" } });
    expect(marked[0]).toMatchObject({ hash: h, mark: { scanId, deviceId: "dev-1" } });
  });

  it("5xx → fallback; a second presentation now reads as a same-device double scan offline", async () => {
    post.mockResolvedValue({ status: 502, data: null });
    await runScan(ctx(), code);
    online = false;
    const again = await runScan(ctx(), code);
    expect(again).toMatchObject({ kind: "already_used_offline", sameDevice: true });
  });

  it("401 → onAuthRequired with the code, then offline fallback", async () => {
    post.mockResolvedValue({ status: 401, data: null, code: "SCANNER_TOKEN_EXPIRED" });
    const out = await runScan(ctx(), code);
    expect(onAuthRequired).toHaveBeenCalledWith("SCANNER_TOKEN_EXPIRED");
    expect(out.kind).toBe("success_offline");
    expect(enqueued[0]).toMatchObject({ kind: "live_fallback" });
  });

  it("429 → onRateLimited(now + Retry-After) then offline fallback", async () => {
    post.mockResolvedValue({ status: 429, data: null, retryAfterSec: 12 });
    await runScan(ctx(), code);
    expect(onRateLimited).toHaveBeenCalledWith(NOW + 12_000);
  });

  it("400 → invalid from the server, NO fallback, nothing consumed", async () => {
    post.mockResolvedValue({ status: 400, data: null, code: "BAD_REQUEST", message: "payload too long" });
    const out = await runScan(ctx(), code);
    expect(out).toMatchObject({ kind: "invalid", source: "server", code: "BAD_REQUEST" });
    expect(enqueued).toHaveLength(0);
  });

  it("degraded / offline: never calls the network; admits from the manifest as offline_admit", async () => {
    online = false;
    const out = await runScan(ctx(), code);
    expect(post).not.toHaveBeenCalled();
    expect(out.kind).toBe("success_offline");
    expect(enqueued[0]).toMatchObject({ kind: "offline_admit" });
  });

  it("garbage never hits the network", async () => {
    const out = await runScan(ctx(), "WIFI:S:cafe;;");
    expect(post).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "invalid", code: "NOT_A_TICKET" });
  });

  it("same code within 2.5 s of the last handled one is ignored", async () => {
    const c = ctx();
    c.recent = () => ({ hash: sha256Hex(code), at: NOW - 1000 });
    expect(await runScan(c, code)).toEqual({ kind: "ignored" });
    expect(post).not.toHaveBeenCalled();
  });

  it("unknown ticket offline → operator choice; admit queues an unverified_admit, deny queues nothing", async () => {
    online = false;
    const unknown = makeV3Qr({ eventId: "42", tokenId: TOKEN_2, qrv: 1, priv: kp.priv });
    const out = await runScan(ctx(), unknown);
    expect(out).toMatchObject({ kind: "authentic_not_in_manifest", payload: unknown, hint: { tokenId: TOKEN_2 } });
    if (out.kind !== "authentic_not_in_manifest") throw new Error("unreachable");
    const denied = await commitUnverified(ctx(), out, "deny");
    expect(denied).toEqual({ kind: "unverifiable_denied", scanId: out.scanId });
    expect(enqueued).toHaveLength(0);
    const admitted = await commitUnverified(ctx(), out, "admit");
    expect(admitted).toMatchObject({ kind: "admitted_unverified", scanId: out.scanId });
    expect(enqueued[0]).toMatchObject({ scanId: out.scanId, kind: "unverified_admit", payload: unknown });
  });

  it("a rejected offline verdict is not queued (nothing was consumed)", async () => {
    online = false;
    rows.set(h, rowOf({ s: "used" }));
    const out = await runScan(ctx(), code);
    expect(out.kind).toBe("already_used_offline");
    expect(enqueued).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });
});
