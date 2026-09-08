/**
 * Wiring between the pure modules (engine, queue, manifest) and the app's
 * stores + BFF. Components call these; nothing here renders.
 */
import { api, handleAuthFailure, type ApiResult } from "@/lib/api";
import { getDeviceId } from "@/lib/device-id";
import { now as clockNow } from "@/lib/clock";
import { browserOnline, getConnectivityMonitor, isEffectivelyOnline } from "@/lib/connectivity";
import { notifyAuthRestored, requestQueueDrain } from "@/lib/events";
import {
  clearLocalUsed,
  ensureManifest,
  getManifestMeta,
  lookupTicket,
  manifestAgeMs,
  markUsedLocally,
  ManifestSyncError,
  syncManifestDelta,
  syncManifestFull,
  type ManifestFetchers,
  type ManifestMeta,
} from "@/lib/manifest";
import { drainOnce, enqueueScan, type DrainResult, type PostResult, type QueuedScan } from "@/lib/scan-queue";
import type { EngineManifest, ScanContext } from "@/lib/scan-engine";
import { appendShiftEntry } from "@/lib/shift-log";
import { beacon } from "@/lib/telemetry";
import { useAuthStore } from "@/stores/auth.store";
import { useSessionStore, type ManifestSummary } from "@/stores/session.store";
import type { ManifestPage } from "@/types/verdict.types";

export const OFFLINE_VALIDATION_ENABLED = process.env.NEXT_PUBLIC_OFFLINE_VALIDATION !== "0";

const toPost = (r: ApiResult): PostResult & { message?: string; timedOut: boolean; networkError: boolean } => ({
  status: r.status,
  data: r.data,
  code: r.code,
  message: r.message,
  retryAfterSec: r.retryAfterSec,
  timedOut: r.timedOut,
  networkError: r.networkError,
});

export function engineManifestOf(meta: ManifestMeta | null): EngineManifest | null {
  if (!meta) return null;
  return {
    eventId: meta.eventId,
    publicKey: meta.publicKey,
    window: meta.window,
    allowedTicketTypeIds: meta.allowedTicketTypeIds,
    ticketTypes: meta.ticketTypes,
    ageMs: manifestAgeMs(meta),
  };
}

/** The engine's view of the world for one scan. */
export function createScanContext(opts: { recent: () => { hash: string; at: number } | null; forceOnline?: boolean }): ScanContext {
  const monitor = getConnectivityMonitor();
  return {
    deviceId: getDeviceId(),
    nowMs: clockNow,
    isOnline: () => {
      if (!browserOnline()) return false;
      if (opts.forceOnline) return true;
      const session = useSessionStore.getState();
      return session.auth !== "reauth_required" && isEffectivelyOnline(monitor.getState(), Date.now());
    },
    browserOnline,
    idbAvailable: !useSessionStore.getState().idbUnavailable,
    offlineEnabled: OFFLINE_VALIDATION_ENABLED,
    manifest: {
      snapshot: async () => engineManifestOf(await getManifestMeta()),
      lookup: (h) => lookupTicket(h),
      markUsedLocally,
    },
    post: async (body, timeoutMs) => toPost(await api.post("scan", body, { timeoutMs })),
    queue: {
      enqueue: async (input) => {
        await enqueueScan(input);
        requestQueueDrain();
      },
    },
    onAuthRequired: handleAuthFailure,
    onRateLimited: (until) => monitor.dispatch({ type: "RATE_LIMITED", until }),
    // The api layer already reports request outcomes to the monitor.
    onNetworkOk: () => {},
    onNetworkFail: () => {},
    recent: opts.recent,
  };
}

const KIND_BY_SERVER_RESULT = {
  success: "success",
  already_used: "already_used",
  wrong_scanner: "wrong_scanner",
  invalid: "invalid",
  outside_window: "outside_window",
} as const;

/** One drain pass against the BFF. */
export async function drainNow(): Promise<DrainResult> {
  const deviceId = getDeviceId();
  return drainOnce({
    postBatch: async (items) => toPost(await api.post("scan/batch", { scans: items, deviceId }, { timeoutMs: 12_000 })),
    postSingle: async (item) => toPost(await api.post("scan", { ...item, source: "offline_replay", deviceId }, { timeoutMs: 6000 })),
    onAuthRequired: handleAuthFailure,
    onSynced: async (rec: QueuedScan) => {
      if (rec.ticketHint?.h) await clearLocalUsed(rec.ticketHint.h, { serverUsed: true }).catch(() => {});
    },
    onReconciled: async (rec: QueuedScan) => {
      const r = rec.serverResult;
      if (!r || r.result === "success") return;
      // An offline admission the server rejected: record the server's word in
      // the shift history next to the operator's own verdict.
      await appendShiftEntry({
        at: rec.capturedAt,
        kind: KIND_BY_SERVER_RESULT[r.result],
        scanId: rec.scanId,
        ownerName: rec.ticketHint?.ownerName ?? ("ticket" in r && r.ticket ? r.ticket.ownerName : undefined),
        ticketTypeName: rec.ticketHint?.ticketTypeName,
        detail: "Admitted offline — the server later rejected this ticket",
        offline: true,
      }).catch(() => {});
      beacon("offline_admission_rejected", { result: r.result, kind: rec.kind });
    },
  });
}

export function manifestFetchers(): ManifestFetchers {
  const failure = (r: ApiResult) => new ManifestSyncError(r.message ?? `Manifest request failed (${r.status})`, r.code ?? (r.timedOut ? "TIMEOUT" : r.networkError ? "NETWORK" : `HTTP_${r.status}`));
  return {
    fetchPage: async (cursor) => {
      const r = await api.get<ManifestPage>("manifest", { searchParams: { cursor: cursor ?? undefined, limit: 5000 }, timeoutMs: 20_000 });
      if (!r.ok || !r.data) throw failure(r);
      return r.data;
    },
    fetchDelta: async (since, cursor) => {
      const r = await api.get<ManifestPage>("manifest/delta", { searchParams: { since, cursor: cursor ?? undefined, limit: 5000 }, timeoutMs: 20_000 });
      if (!r.ok || !r.data) throw failure(r);
      return r.data;
    },
  };
}

export function summaryOf(meta: ManifestMeta): ManifestSummary {
  return {
    eventId: meta.eventId,
    eventName: meta.eventName,
    count: meta.count,
    syncedAt: meta.syncedAt,
    lastDeltaAt: meta.lastDeltaAt,
    window: meta.window,
    ticketTypes: meta.ticketTypes.map((t) => ({ id: t.id, name: t.name })),
  };
}

let manifestSyncInFlight: Promise<void> | null = null;

/**
 * Bring the manifest up to date for the signed-in scanner's event. Serialised;
 * failures are shown in the chrome, never thrown at the caller.
 */
export function syncManifestNow(mode: "auto" | "full" | "delta" = "auto"): Promise<void> {
  if (manifestSyncInFlight) return manifestSyncInFlight;
  manifestSyncInFlight = (async () => {
    const session = useSessionStore.getState();
    const scanner = useAuthStore.getState().scanner;
    if (!scanner || session.idbUnavailable || !OFFLINE_VALIDATION_ENABLED) return;
    if (!browserOnline()) return;
    const f = manifestFetchers();
    session.setManifestSync(mode === "delta" ? "delta" : "full");
    try {
      let meta: ManifestMeta;
      if (mode === "full") meta = await syncManifestFull(f);
      else if (mode === "delta") meta = await syncManifestDelta(f);
      else meta = await ensureManifest(f, scanner.eventId);
      useSessionStore.getState().setManifest(summaryOf(meta));
      useSessionStore.getState().setManifestSync("idle");
    } catch (error) {
      const code = error instanceof ManifestSyncError ? error.code : "UNKNOWN";
      // A 401 already flipped the session; do not double-report.
      useSessionStore.getState().setManifestSync("error", code === "NO_SESSION" ? null : error instanceof Error ? error.message : "Sync failed");
      beacon("manifest_sync_failed", { code });
    }
  })().finally(() => {
    manifestSyncInFlight = null;
  });
  return manifestSyncInFlight;
}

/** Load whatever manifest is on disk into the session summary (no network). */
export async function loadManifestSummary(): Promise<void> {
  const meta = await getManifestMeta().catch(() => null);
  useSessionStore.getState().setManifest(meta ? summaryOf(meta) : null);
}

/** After a successful (re)login: mark the session live and kick the background work. */
export function sessionRestored(): void {
  useSessionStore.getState().setAuth("authenticated");
  useSessionStore.getState().setRenewalFailed(false);
  notifyAuthRestored();
  requestQueueDrain();
  void syncManifestNow("auto");
}
