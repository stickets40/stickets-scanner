import { parseQr, verifyV3, type ParsedQr } from "@/lib/qr-v3";
import { sha256Hex } from "@/lib/hash";
import type { LookupResult, ManifestMeta } from "@/lib/manifest";
import type { QueueKind, TicketHint } from "@/lib/scan-queue";
import {
  invalidMessage,
  parseServerVerdict,
  type ServerVerdict,
  type TicketSummary,
  type UnverifiableReason,
  type Verdict,
} from "@/types/verdict.types";

/**
 * The scan engine: one entry point per presented code.
 *
 * Online → ask the server (4 s). Anything but an answer — timeout, 5xx,
 * unreachable, session expired, rate limited — falls back to the OFFLINE
 * decision with the SAME scanId, so whatever the server may already have
 * recorded for that attempt reconciles as a replay, never as a duplicate.
 *
 * Offline → `decide()`: a pure, ordered table over the parsed code, the
 * device manifest and the corrected clock. Admissions are consumed locally
 * and queued; rejections are not queued (nothing was consumed).
 */

export const SAME_CODE_COOLDOWN_MS = 2500;
export const LIVE_SCAN_TIMEOUT_MS = 4000;

export interface EngineManifest {
  eventId: string;
  publicKey: string;
  window: { opensAt: string; closesAt: string };
  allowedTicketTypeIds: number[];
  ticketTypes: ManifestMeta["ticketTypes"];
  ageMs: number;
}

export interface DecideInput {
  parsed: ParsedQr;
  payloadHash: string;
  manifest: EngineManifest | null;
  lookup: LookupResult | null;
  nowMs: number;
  deviceId: string;
  idbAvailable: boolean;
  offlineEnabled: boolean;
  recent: { hash: string; at: number } | null;
}

export type OfflinePlan =
  | { plan: "ignore" }
  | { plan: "invalid"; code: string }
  | { plan: "unverifiable"; reason: UnverifiableReason }
  | { plan: "authentic_not_in_manifest"; h: string; tokenId: string; eventId: string; manifestAgeMs: number }
  | { plan: "already_used"; ticket: TicketSummary; sameDevice: boolean; usedAt: string | null; manifestAgeMs: number }
  | { plan: "wrong_scanner"; ticketTypeId: number; ticket: TicketSummary }
  | { plan: "outside_window"; reason: "too_early" | "too_late"; opensAt: string; closesAt: string; ticket: TicketSummary }
  | { plan: "admit"; h: string; ticket: TicketSummary; manifestAgeMs: number };

function typeName(manifest: EngineManifest | null, id: number): string {
  return manifest?.ticketTypes.find((t) => t.id === id)?.name ?? `Type #${id}`;
}

/** The offline rulebook — first matching row wins. */
export function decide(input: DecideInput): OfflinePlan {
  const { parsed, manifest, lookup } = input;
  if (input.recent && input.recent.hash === input.payloadHash && input.nowMs - input.recent.at < SAME_CODE_COOLDOWN_MS) {
    return { plan: "ignore" };
  }
  if (parsed.kind === "not_a_ticket") return { plan: "invalid", code: "NOT_A_TICKET" };
  if (parsed.kind === "legacy_v2") return { plan: "unverifiable", reason: "legacy_format" };
  if (!input.offlineEnabled) return { plan: "unverifiable", reason: "offline_disabled" };
  if (!input.idbAvailable) return { plan: "unverifiable", reason: "idb_unavailable" };
  if (!manifest || !manifest.publicKey) return { plan: "unverifiable", reason: "no_manifest" };
  if (parsed.eventId !== manifest.eventId) return { plan: "invalid", code: "WRONG_EVENT" };
  if (!verifyV3(parsed, manifest.publicKey)) return { plan: "invalid", code: "BAD_SIGNATURE" };

  const entry = lookup?.entry ?? null;
  if (!entry) {
    return { plan: "authentic_not_in_manifest", h: parsed.h, tokenId: parsed.tokenId, eventId: parsed.eventId, manifestAgeMs: manifest.ageMs };
  }
  const ticket: TicketSummary = {
    ownerName: entry.n || "Unknown",
    ticketTypeName: typeName(manifest, entry.tt),
    ticketTypeId: entry.tt,
    tokenId: parsed.tokenId,
  };
  if (parsed.qrv < entry.v) return { plan: "invalid", code: "STALE_QR" };
  if (parsed.qrv > entry.v) {
    // The code is newer than our copy of the ticket (transferred since the
    // last sync). Authentic, but the device cannot say whether it is current.
    return { plan: "authentic_not_in_manifest", h: parsed.h, tokenId: parsed.tokenId, eventId: parsed.eventId, manifestAgeMs: manifest.ageMs };
  }
  const status = lookup?.effectiveStatus ?? "valid";
  if (status === "used" || status === "used_local") {
    return {
      plan: "already_used",
      ticket,
      sameDevice: status === "used_local" && entry.localDeviceId === input.deviceId,
      usedAt: status === "used_local" ? entry.localUsedAt ?? null : null,
      manifestAgeMs: manifest.ageMs,
    };
  }
  if (manifest.allowedTicketTypeIds.length > 0 && !manifest.allowedTicketTypeIds.includes(entry.tt)) {
    return { plan: "wrong_scanner", ticketTypeId: entry.tt, ticket };
  }
  const opens = Date.parse(manifest.window.opensAt);
  const closes = Date.parse(manifest.window.closesAt);
  if (Number.isFinite(opens) && input.nowMs < opens) {
    return { plan: "outside_window", reason: "too_early", opensAt: manifest.window.opensAt, closesAt: manifest.window.closesAt, ticket };
  }
  if (Number.isFinite(closes) && input.nowMs > closes) {
    return { plan: "outside_window", reason: "too_late", opensAt: manifest.window.opensAt, closesAt: manifest.window.closesAt, ticket };
  }
  return { plan: "admit", h: parsed.h, ticket, manifestAgeMs: manifest.ageMs };
}

// ---------------------------------------------------------------------------

export interface PostScanResult {
  status: number;
  data: unknown;
  code?: string;
  message?: string;
  retryAfterSec?: number;
  timedOut?: boolean;
  networkError?: boolean;
}

export interface ScanRequest {
  payload: string;
  scanId: string;
  deviceId: string;
  capturedAt: string;
  source: "live";
}

export interface ScanContext {
  deviceId: string;
  nowMs: () => number;
  /** Confirmed-good network (not degraded, not rate limited). */
  isOnline: () => boolean;
  browserOnline: () => boolean;
  idbAvailable: boolean;
  offlineEnabled: boolean;
  manifest: {
    snapshot(): Promise<EngineManifest | null>;
    lookup(h: string): Promise<LookupResult>;
    markUsedLocally(h: string, mark: { deviceId: string; scanId: string; at: string }): Promise<void>;
  };
  post(body: ScanRequest, timeoutMs: number): Promise<PostScanResult>;
  queue: {
    enqueue(input: { scanId: string; payload: string; capturedAt: string; kind: QueueKind; localVerdict: string; ticketHint?: TicketHint }): Promise<void>;
  };
  onAuthRequired(code: string): void;
  onRateLimited(untilMs: number): void;
  onNetworkOk(): void;
  onNetworkFail(): void;
  recent: () => { hash: string; at: number } | null;
}

export type ScanOutcome = Verdict | { kind: "ignored" };

export function serverToVerdict(scanId: string, v: ServerVerdict): Verdict {
  switch (v.result) {
    case "success":
      return { kind: "success", scanId, server: v, ticket: { ...v.ticket } };
    case "already_used":
      return {
        kind: "already_used",
        scanId,
        server: v,
        ticket: { ownerName: v.ticket.ownerName, ticketTypeName: v.ticket.ticketTypeName ?? "", tokenId: v.ticket.tokenId, seatInfo: v.ticket.seatInfo },
      };
    case "wrong_scanner":
      return { kind: "wrong_scanner", scanId, source: "server", correctScannerNames: v.correctScannerNames, message: v.message, ticketTypeId: v.ticketTypeId };
    case "outside_window":
      return { kind: "outside_window", scanId, source: "server", reason: v.reason, opensAt: v.opensAt, closesAt: v.closesAt, ticket: v.ticket };
    case "invalid":
      return { kind: "invalid", scanId, source: "server", code: v.code, message: v.message || invalidMessage(v.code) };
  }
}

/**
 * Scan one presented code. Returns the verdict to show; choice kinds
 * (`authentic_not_in_manifest`, `unverifiable`) are completed by
 * commitUnverified() once the operator decides.
 */
export async function runScan(ctx: ScanContext, rawPayload: string, scanIdOverride?: string): Promise<ScanOutcome> {
  const payloadHash = sha256Hex(rawPayload);
  const recent = ctx.recent();
  const nowMs = ctx.nowMs();
  if (recent && recent.hash === payloadHash && nowMs - recent.at < SAME_CODE_COOLDOWN_MS) return { kind: "ignored" };

  const scanId = scanIdOverride ?? crypto.randomUUID();
  const capturedAt = new Date(nowMs).toISOString();
  const parsed = parseQr(rawPayload);

  // A foreign code (Wi-Fi, another vendor) needs no server round trip.
  if (parsed.kind === "not_a_ticket") {
    return { kind: "invalid", scanId, source: "offline", code: "NOT_A_TICKET", message: invalidMessage("NOT_A_TICKET") };
  }

  let attemptedOnline = false;
  if (ctx.isOnline()) {
    attemptedOnline = true;
    const res = await ctx.post({ payload: rawPayload, scanId, deviceId: ctx.deviceId, capturedAt, source: "live" }, LIVE_SCAN_TIMEOUT_MS);
    if (res.status >= 200 && res.status < 300) {
      try {
        const verdict = parseServerVerdict(res.data);
        ctx.onNetworkOk();
        return serverToVerdict(scanId, verdict);
      } catch {
        // Contract drift: treat as a transport problem, fall back offline.
        ctx.onNetworkFail();
      }
    } else if (res.status === 401 || res.status === 403) {
      ctx.onAuthRequired(res.code ?? "SCANNER_TOKEN_INVALID");
    } else if (res.status === 429) {
      ctx.onRateLimited(ctx.nowMs() + (res.retryAfterSec ?? 30) * 1000);
    } else if (res.status === 400) {
      // The request itself was malformed (e.g. payload too long) — nothing
      // offline can do better, and retrying will not help.
      return { kind: "invalid", scanId, source: "server", code: res.code ?? "BAD_REQUEST", message: res.message ?? "Could not read this code" };
    } else {
      ctx.onNetworkFail();
    }
  }

  // Offline / fallback decision.
  const manifest = await ctx.manifest.snapshot().catch(() => null);
  const lookup = parsed.kind === "v3" && ctx.idbAvailable ? await ctx.manifest.lookup(parsed.h).catch(() => null) : null;
  const plan = decide({
    parsed,
    payloadHash,
    manifest,
    lookup,
    nowMs: ctx.nowMs(),
    deviceId: ctx.deviceId,
    idbAvailable: ctx.idbAvailable,
    offlineEnabled: ctx.offlineEnabled,
    recent: null,
  });
  const canTryOnline = ctx.browserOnline();

  switch (plan.plan) {
    case "ignore":
      return { kind: "ignored" };
    case "invalid":
      return { kind: "invalid", scanId, source: "offline", code: plan.code, message: invalidMessage(plan.code) };
    case "unverifiable":
      return { kind: "unverifiable", scanId, payload: rawPayload, reason: plan.reason, canTryOnline };
    case "authentic_not_in_manifest":
      return { kind: "authentic_not_in_manifest", scanId, payload: rawPayload, hint: { h: plan.h, tokenId: plan.tokenId, eventId: plan.eventId }, manifestAgeMs: plan.manifestAgeMs, canTryOnline };
    case "already_used":
      return { kind: "already_used_offline", scanId, ticket: plan.ticket, sameDevice: plan.sameDevice, usedAt: plan.usedAt, manifestAgeMs: plan.manifestAgeMs };
    case "wrong_scanner":
      return { kind: "wrong_scanner", scanId, source: "offline", correctScannerNames: [], message: null, ticketTypeId: plan.ticketTypeId, ticket: plan.ticket };
    case "outside_window":
      return { kind: "outside_window", scanId, source: "offline", reason: plan.reason, opensAt: plan.opensAt, closesAt: plan.closesAt, ticket: plan.ticket };
    case "admit": {
      await ctx.manifest.markUsedLocally(plan.h, { deviceId: ctx.deviceId, scanId, at: capturedAt });
      await ctx.queue.enqueue({
        scanId,
        payload: rawPayload,
        capturedAt,
        kind: attemptedOnline ? "live_fallback" : "offline_admit",
        localVerdict: "success",
        ticketHint: { h: plan.h, tokenId: plan.ticket.tokenId, ownerName: plan.ticket.ownerName, ticketTypeName: plan.ticket.ticketTypeName },
      });
      return { kind: "success_offline", scanId, ticket: plan.ticket, capturedAt, manifestAgeMs: plan.manifestAgeMs };
    }
  }
}

/** Resolve an operator choice on an unverifiable / not-in-manifest code. */
export async function commitUnverified(
  ctx: Pick<ScanContext, "queue" | "nowMs">,
  verdict: Extract<Verdict, { kind: "unverifiable" | "authentic_not_in_manifest" }>,
  decision: "admit" | "deny"
): Promise<Verdict> {
  if (decision === "deny") return { kind: "unverifiable_denied", scanId: verdict.scanId };
  const capturedAt = new Date(ctx.nowMs()).toISOString();
  await ctx.queue.enqueue({
    scanId: verdict.scanId,
    payload: verdict.payload,
    capturedAt,
    kind: "unverified_admit",
    localVerdict: "unverified",
    ticketHint: verdict.kind === "authentic_not_in_manifest" ? { h: verdict.hint.h, tokenId: verdict.hint.tokenId } : undefined,
  });
  return { kind: "admitted_unverified", scanId: verdict.scanId, capturedAt };
}
