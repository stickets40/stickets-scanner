import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeConflict,
  backoffMs,
  claimDue,
  drainOnce,
  enqueueScan,
  listConflicts,
  listStalled,
  MAX_ATTEMPTS,
  queueCounts,
  retryStalled,
  revertOfflineAdmission,
  settleRecord,
  type QueuedScan,
} from "@/lib/scan-queue";
import type { ServerVerdict } from "@/types/verdict.types";
import { resetDb } from "./helpers/idb";

const uuid = () => crypto.randomUUID();
const input = (scanId = uuid(), over: Partial<Parameters<typeof enqueueScan>[0]> = {}) => ({
  scanId,
  payload: `ST3.42.tok${scanId.slice(0, 6)}.1.sig`,
  capturedAt: new Date().toISOString(),
  kind: "offline_admit" as const,
  localVerdict: "success",
  ...over,
});

const success = (): ServerVerdict => ({
  result: "success",
  scanLogId: "log",
  undoableUntil: "2026-09-05T18:05:00.000Z",
  ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, nftId: "t", tokenId: "t", seatInfo: null },
  serverTime: "2026-09-05T18:00:00.000Z",
});
const alreadyUsed = (): ServerVerdict => ({
  result: "already_used",
  ticket: { ownerName: "Bob", seatInfo: null, firstUsedAt: "2026-09-05T17:00:00.000Z", tokenId: "t" },
  firstScannedBy: null,
  secondsAgo: 100,
  sameDevice: false,
  serverTime: "2026-09-05T18:00:00.000Z",
});

const rec = (over: Partial<QueuedScan> = {}): QueuedScan => ({
  scanId: "s",
  payload: "p",
  payloadHash: "h",
  capturedAt: "2026-09-05T18:00:00.000Z",
  kind: "offline_admit",
  status: "syncing",
  attempts: 0,
  nextAttemptAt: 0,
  claimedAt: 1,
  seq: 1,
  localVerdict: "success",
  ...over,
});

describe("settleRecord — state machine", () => {
  const now = 1_000_000;
  it("success → synced; other verdicts → needs_review", () => {
    expect(settleRecord(rec(), { type: "verdict", verdict: success() }, now).record).toMatchObject({ status: "synced", claimedAt: null });
    expect(settleRecord(rec(), { type: "verdict", verdict: alreadyUsed() }, now).record.status).toBe("needs_review");
  });
  it("401/403 → pending + needsAuth and the drain stops", () => {
    const s = settleRecord(rec(), { type: "http", status: 401 }, now);
    expect(s.record).toMatchObject({ status: "pending", needsAuth: true });
    expect(s.stop).toBe("auth");
  });
  it("429 → wait Retry-After (default 30 s) and stop", () => {
    const s = settleRecord(rec(), { type: "http", status: 429, retryAfterSec: 7 }, now);
    expect(s.record.nextAttemptAt).toBe(now + 7000);
    expect(s.stop).toBe("rate_limit");
    expect(settleRecord(rec(), { type: "http", status: 429 }, now).record.nextAttemptAt).toBe(now + 30_000);
  });
  it("5xx / network → exponential backoff with jitter, stalled after MAX_ATTEMPTS", () => {
    const s1 = settleRecord(rec(), { type: "http", status: 503 }, now, 0.5);
    expect(s1.record).toMatchObject({ status: "pending", attempts: 1, nextAttemptAt: now + backoffMs(1, 0.5) });
    const s2 = settleRecord(rec({ attempts: MAX_ATTEMPTS - 1 }), { type: "http", status: 0 }, now);
    expect(s2.record.status).toBe("stalled");
    expect(backoffMs(0, 0.5)).toBe(1000);
    expect(backoffMs(6, 0.5)).toBe(60_000);
    expect(backoffMs(20, 1)).toBe(90_000);
  });
  it("non-auth 4xx → failed_permanent; SCAN_ID_CONFLICT item error → failed_permanent; SCAN_ERROR → retry", () => {
    expect(settleRecord(rec(), { type: "http", status: 404 }, now).record.status).toBe("failed_permanent");
    expect(settleRecord(rec(), { type: "item_error", code: "SCAN_ID_CONFLICT", message: "x" }, now).record).toMatchObject({ status: "failed_permanent", serverError: { code: "SCAN_ID_CONFLICT" } });
    expect(settleRecord(rec(), { type: "item_error", code: "SCAN_ERROR", message: "db" }, now).record).toMatchObject({ status: "pending", attempts: 1 });
  });
});

describe("queue (IndexedDB)", () => {
  beforeEach(resetDb);

  it("enqueue is idempotent by scanId, keeps door order, and counts", async () => {
    const a = await enqueueScan(input());
    const again = await enqueueScan(input(a.scanId));
    expect(again.seq).toBe(a.seq);
    const b = await enqueueScan(input());
    expect(b.seq).toBe(a.seq + 1);
    expect(await queueCounts()).toMatchObject({ pending: 2, unverified: 2 });
  });

  it("claimDue takes due pending rows in order, marks them syncing, and reclaims stale claims", async () => {
    const a = await enqueueScan(input());
    const b = await enqueueScan(input());
    const claimed = await claimDue(Date.now());
    expect(claimed.map((r) => r.scanId)).toEqual([a.scanId, b.scanId]);
    expect(await claimDue(Date.now())).toEqual([]); // already syncing
    // a tab died: 61 s later the rows are reclaimable
    const reclaimed = await claimDue(Date.now() + 61_000);
    expect(reclaimed).toHaveLength(2);
  });

  it("drainOnce: batch POST → synced rows purged (+onSynced), rejections parked for review, results matched by scanId", async () => {
    const good = await enqueueScan(input(uuid(), { ticketHint: { h: "hash-good", ownerName: "Alice" } }));
    const bad = await enqueueScan(input());
    const postBatch = vi.fn(async (items: Array<{ scanId: string }>) => ({
      status: 200,
      data: {
        results: items.map((i) => ({ scanId: i.scanId, verdict: i.scanId === good.scanId ? success() : alreadyUsed() })).reverse(),
        serverTime: "2026-09-05T18:00:00.000Z",
      },
    }));
    const onSynced = vi.fn();
    const res = await drainOnce({ postBatch, postSingle: vi.fn(), onSynced });
    expect(res).toMatchObject({ processed: 2, synced: 1, reviewed: 1, stoppedBy: null });
    expect(postBatch.mock.calls[0][0].map((i: { scanId: string }) => i.scanId)).toEqual([good.scanId, bad.scanId]);
    expect(onSynced).toHaveBeenCalledWith(expect.objectContaining({ scanId: good.scanId }));
    expect(await queueCounts()).toMatchObject({ pending: 0, needsReview: 1, unverified: 0 });
    const [conflict] = await listConflicts();
    expect(conflict.scanId).toBe(bad.scanId);
    expect(conflict.serverResult?.result).toBe("already_used");
    // conflicts are never re-sent and only leave on acknowledgement
    postBatch.mockClear();
    expect((await drainOnce({ postBatch, postSingle: vi.fn() })).stoppedBy).toBe("nothing");
    expect(postBatch).not.toHaveBeenCalled();
    await acknowledgeConflict(bad.scanId);
    expect(await queueCounts()).toMatchObject({ needsReview: 0 });
  });

  it("drainOnce: 401 keeps rows pending, flags needsAuth, stops and reports the code", async () => {
    await enqueueScan(input());
    const onAuthRequired = vi.fn();
    const res = await drainOnce({ postBatch: async () => ({ status: 401, data: null, code: "SCANNER_TOKEN_EXPIRED" }), postSingle: vi.fn(), onAuthRequired });
    expect(res.stoppedBy).toBe("auth");
    expect(onAuthRequired).toHaveBeenCalledWith("SCANNER_TOKEN_EXPIRED");
    expect(await queueCounts()).toMatchObject({ pending: 1 });
  });

  it("drainOnce: 429 defers by Retry-After; 5xx backs off; a stalled row can be retried", async () => {
    const a = await enqueueScan(input());
    const now = Date.now();
    await drainOnce({ postBatch: async () => ({ status: 429, data: null, retryAfterSec: 60 }), postSingle: vi.fn(), now: () => now });
    expect(await claimDue(now + 1000)).toEqual([]);
    expect(await claimDue(now + 61_000)).toHaveLength(1);
    // exhaust attempts
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drainOnce({ postBatch: async () => ({ status: 503, data: null }), postSingle: vi.fn(), now: () => now + 10_000_000 * (i + 1) });
    }
    expect((await listStalled()).map((r) => r.scanId)).toEqual([a.scanId]);
    expect(await retryStalled()).toBe(1);
    expect(await queueCounts()).toMatchObject({ pending: 1, stalled: 0 });
  });

  it("drainOnce: a 400 on the batch falls back to per-record POSTs; a per-record 4xx is permanent", async () => {
    const ok = await enqueueScan(input());
    const broken = await enqueueScan(input());
    const postSingle = vi.fn(async (item: { scanId: string }) => (item.scanId === ok.scanId ? { status: 200, data: success() } : { status: 400, data: null, code: "BAD_REQUEST" }));
    const res = await drainOnce({ postBatch: async () => ({ status: 400, data: null }), postSingle });
    expect(res.synced).toBe(1);
    expect(postSingle).toHaveBeenCalledTimes(2);
    expect((await listStalled()).map((r) => r.status)).toEqual(["failed_permanent"]);
    expect((await listStalled())[0].scanId).toBe(broken.scanId);
  });

  it("revertOfflineAdmission removes only pending/stalled rows", async () => {
    const a = await enqueueScan(input());
    expect((await revertOfflineAdmission(a.scanId))?.scanId).toBe(a.scanId);
    expect(await revertOfflineAdmission(a.scanId)).toBeNull();
    const b = await enqueueScan(input());
    await drainOnce({ postBatch: async (items) => ({ status: 200, data: { results: items.map((i) => ({ scanId: i.scanId, verdict: alreadyUsed() })), serverTime: "x" } }), postSingle: vi.fn() });
    expect(await revertOfflineAdmission(b.scanId)).toBeNull(); // needs_review is not revertable
  });

  it("only one drain runs at a time", async () => {
    await enqueueScan(input());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = drainOnce({
      postBatch: async () => {
        await gate;
        return { status: 200, data: { results: [], serverTime: "x" } };
      },
      postSingle: vi.fn(),
    });
    const second = await drainOnce({ postBatch: vi.fn(), postSingle: vi.fn() });
    expect(second.stoppedBy).toBe("lock");
    release();
    await slow;
  });
});
