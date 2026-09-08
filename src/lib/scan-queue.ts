/**
 * Offline scan queue (IndexedDB, keyed by scanId).
 *
 * Every admission the device made without a server answer — offline, as a
 * fallback after a timeout, or as an operator's unverified admit — waits here
 * until the server confirms it. Records are POSTed in batches (≤ 50) with
 * their ORIGINAL scanId, so a replay after a lost ACK is idempotent end to end
 * and can never read as a second, rejected presentation.
 *
 * THE RECONCILIATION RULE: a queued admission the server answers with anything
 * but `success` means the operator physically admitted someone they should
 * not have. It is parked as `needs_review`, never auto-deleted, and shown to a
 * human. Only `success` is housekeeping.
 */
import { parseServerVerdict, batchResponseSchema, type ServerVerdict } from "@/types/verdict.types";
import { reqToPromise, STORE_COUNTERS, STORE_QUEUE, withTx } from "@/lib/idb";
import { sha256Hex } from "@/lib/hash";
import { notifyQueueChanged } from "@/lib/events";

export type QueueKind = "offline_admit" | "live_fallback" | "unverified_admit";
export type QueuedScanStatus = "pending" | "syncing" | "synced" | "needs_review" | "stalled" | "failed_permanent";

export interface TicketHint {
  h?: string;
  tokenId?: string;
  ownerName?: string;
  ticketTypeName?: string;
}

export interface QueuedScan {
  scanId: string;
  payload: string;
  payloadHash: string;
  capturedAt: string;
  kind: QueueKind;
  status: QueuedScanStatus;
  attempts: number;
  /** Epoch ms; the drain skips records not yet due. */
  nextAttemptAt: number;
  claimedAt: number | null;
  seq: number;
  /** What the device decided locally (for the reconciliation sheet). */
  localVerdict: string;
  ticketHint?: TicketHint;
  serverResult?: ServerVerdict;
  serverError?: { code: string; message: string };
  needsAuth?: boolean;
  syncedAt?: string;
  lastError?: string;
}

export const QUEUE_CAP = 5000;
export const BATCH_SIZE = 50;
export const CLAIM_TIMEOUT_MS = 60_000;
export const MAX_ATTEMPTS = 50;
const SEQ_KEY = "queueSeq";

export class QueueFullError extends Error {
  constructor() {
    super("Offline queue is full");
    this.name = "QueueFullError";
  }
}

export interface EnqueueInput {
  scanId: string;
  payload: string;
  capturedAt: string;
  kind: QueueKind;
  localVerdict: string;
  ticketHint?: TicketHint;
}

/** Add a record. Evicts the oldest synced rows when at the cap; throws QueueFullError when none can go. */
export async function enqueueScan(input: EnqueueInput): Promise<QueuedScan> {
  const payloadHash = sha256Hex(input.payload);
  const record = await withTx([STORE_QUEUE, STORE_COUNTERS], "readwrite", async (t) => {
    const store = t.objectStore(STORE_QUEUE);
    const existing = (await reqToPromise(store.get(input.scanId))) as QueuedScan | undefined;
    if (existing) return existing;

    const count = await reqToPromise(store.count());
    if (count >= QUEUE_CAP) {
      const synced = (await reqToPromise(store.index("status").getAll("synced", 1))) as QueuedScan[];
      if (synced.length === 0) throw new QueueFullError();
      store.delete(synced[0].scanId);
    }

    const counters = t.objectStore(STORE_COUNTERS);
    const row = ((await reqToPromise(counters.get(SEQ_KEY))) as { key: string; value: number } | undefined) ?? { key: SEQ_KEY, value: 0 };
    row.value += 1;
    counters.put(row);

    const rec: QueuedScan = {
      scanId: input.scanId,
      payload: input.payload,
      payloadHash,
      capturedAt: input.capturedAt,
      kind: input.kind,
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      claimedAt: null,
      seq: row.value,
      localVerdict: input.localVerdict,
      ticketHint: input.ticketHint,
    };
    store.put(rec);
    return rec;
  });
  notifyQueueChanged();
  return record;
}

async function allRecords(): Promise<QueuedScan[]> {
  return (await withTx(STORE_QUEUE, "readonly", (t) => reqToPromise(t.objectStore(STORE_QUEUE).getAll()))) as QueuedScan[];
}

export interface QueueCounts {
  pending: number;
  syncing: number;
  needsReview: number;
  stalled: number;
  failed: number;
  /** pending + syncing + stalled — unverified admissions the device is carrying. */
  unverified: number;
}

export async function queueCounts(): Promise<QueueCounts> {
  const all = await allRecords();
  const c = { pending: 0, syncing: 0, needsReview: 0, stalled: 0, failed: 0, unverified: 0 };
  for (const r of all) {
    if (r.status === "pending") c.pending += 1;
    else if (r.status === "syncing") c.syncing += 1;
    else if (r.status === "needs_review") c.needsReview += 1;
    else if (r.status === "stalled") c.stalled += 1;
    else if (r.status === "failed_permanent") c.failed += 1;
  }
  c.unverified = c.pending + c.syncing + c.stalled;
  return c;
}

export async function pendingCount(): Promise<number> {
  return (await queueCounts()).unverified;
}

export async function listConflicts(): Promise<QueuedScan[]> {
  const all = await allRecords();
  return all.filter((r) => r.status === "needs_review").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function listStalled(): Promise<QueuedScan[]> {
  const all = await allRecords();
  return all.filter((r) => r.status === "stalled" || r.status === "failed_permanent").sort((a, b) => a.seq - b.seq);
}

export async function listPending(): Promise<QueuedScan[]> {
  const all = await allRecords();
  return all.filter((r) => r.status === "pending" || r.status === "syncing").sort((a, b) => a.seq - b.seq);
}

export async function getQueued(scanId: string): Promise<QueuedScan | null> {
  const rec = (await withTx(STORE_QUEUE, "readonly", (t) => reqToPromise(t.objectStore(STORE_QUEUE).get(scanId)))) as QueuedScan | undefined;
  return rec ?? null;
}

/** Dismiss a reviewed conflict. Only ever called from an explicit user action. */
export async function acknowledgeConflict(scanId: string): Promise<void> {
  await withTx(STORE_QUEUE, "readwrite", (t) => reqToPromise(t.objectStore(STORE_QUEUE).delete(scanId)));
  notifyQueueChanged();
}

/** Operator reverts an offline admission before it reached the server (pending/stalled only). */
export async function revertOfflineAdmission(scanId: string): Promise<QueuedScan | null> {
  const removed = await withTx(STORE_QUEUE, "readwrite", async (t) => {
    const store = t.objectStore(STORE_QUEUE);
    const rec = (await reqToPromise(store.get(scanId))) as QueuedScan | undefined;
    if (!rec || (rec.status !== "pending" && rec.status !== "stalled")) return null;
    store.delete(scanId);
    return rec;
  });
  if (removed) notifyQueueChanged();
  return removed;
}

export async function retryStalled(): Promise<number> {
  const n = await withTx(STORE_QUEUE, "readwrite", async (t) => {
    const store = t.objectStore(STORE_QUEUE);
    const rows = (await reqToPromise(store.index("status").getAll("stalled"))) as QueuedScan[];
    for (const r of rows) store.put({ ...r, status: "pending", attempts: 0, nextAttemptAt: 0, claimedAt: null });
    return rows.length;
  });
  if (n) notifyQueueChanged();
  return n;
}

/** Delete synced rows (their local marks were cleared by the caller). */
export async function purgeSynced(): Promise<QueuedScan[]> {
  return withTx(STORE_QUEUE, "readwrite", async (t) => {
    const store = t.objectStore(STORE_QUEUE);
    const rows = (await reqToPromise(store.index("status").getAll("synced"))) as QueuedScan[];
    for (const r of rows) store.delete(r.scanId);
    return rows;
  });
}

/**
 * Claim up to `limit` due records for one drain in ONE readwrite transaction:
 * `pending` rows whose nextAttemptAt has passed, plus `syncing` rows whose
 * claim is older than CLAIM_TIMEOUT_MS (a tab died mid-drain). Ordered by
 * capture sequence so the server sees admissions in door order.
 */
export async function claimDue(now: number, limit = BATCH_SIZE): Promise<QueuedScan[]> {
  return withTx(STORE_QUEUE, "readwrite", async (t) => {
    const store = t.objectStore(STORE_QUEUE);
    const pending = (await reqToPromise(store.index("status").getAll("pending"))) as QueuedScan[];
    const syncing = (await reqToPromise(store.index("status").getAll("syncing"))) as QueuedScan[];
    const due = [
      ...pending.filter((r) => r.nextAttemptAt <= now),
      ...syncing.filter((r) => (r.claimedAt ?? 0) < now - CLAIM_TIMEOUT_MS),
    ]
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    for (const r of due) {
      r.status = "syncing";
      r.claimedAt = now;
      store.put(r);
    }
    return due;
  });
}

export function backoffMs(attempts: number, rand = Math.random()): number {
  const base = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
  return Math.round(base * (0.5 + rand));
}

export type SettleOutcome =
  | { type: "verdict"; verdict: ServerVerdict }
  | { type: "item_error"; code: string; message: string }
  | { type: "http"; status: number; retryAfterSec?: number; code?: string };

/** Pure per-record state machine. Returns the updated record and whether the drain must stop. */
export function settleRecord(
  rec: QueuedScan,
  outcome: SettleOutcome,
  now: number,
  rand = Math.random()
): { record: QueuedScan; stop: "auth" | "rate_limit" | null } {
  const next: QueuedScan = { ...rec, claimedAt: null, needsAuth: undefined };
  if (outcome.type === "verdict") {
    next.serverResult = outcome.verdict;
    next.serverError = undefined;
    next.lastError = undefined;
    if (outcome.verdict.result === "success") {
      next.status = "synced";
      next.syncedAt = new Date(now).toISOString();
    } else {
      next.status = "needs_review";
    }
    return { record: next, stop: null };
  }
  if (outcome.type === "item_error") {
    next.lastError = `${outcome.code}: ${outcome.message}`;
    if (outcome.code === "SCAN_ID_CONFLICT" || outcome.code === "BAD_REQUEST") {
      next.status = "failed_permanent";
      next.serverError = { code: outcome.code, message: outcome.message };
      return { record: next, stop: null };
    }
    return retryLater(next, now, rand);
  }
  const { status } = outcome;
  if (status === 401 || status === 403) {
    next.status = "pending";
    next.needsAuth = true;
    next.lastError = `HTTP ${status}`;
    return { record: next, stop: "auth" };
  }
  if (status === 429) {
    next.status = "pending";
    next.nextAttemptAt = now + (outcome.retryAfterSec ?? 30) * 1000;
    next.lastError = "HTTP 429";
    return { record: next, stop: "rate_limit" };
  }
  if (status >= 400 && status < 500) {
    next.status = "failed_permanent";
    next.serverError = { code: outcome.code ?? `HTTP_${status}`, message: `HTTP ${status}` };
    next.lastError = `HTTP ${status}`;
    return { record: next, stop: null };
  }
  next.lastError = status === 0 ? "network" : `HTTP ${status}`;
  return retryLater(next, now, rand);
}

function retryLater(next: QueuedScan, now: number, rand: number): { record: QueuedScan; stop: null } {
  next.attempts += 1;
  if (next.attempts >= MAX_ATTEMPTS) {
    next.status = "stalled";
    return { record: next, stop: null };
  }
  next.status = "pending";
  next.nextAttemptAt = now + backoffMs(next.attempts, rand);
  return { record: next, stop: null };
}

async function putAll(records: QueuedScan[]): Promise<void> {
  await withTx(STORE_QUEUE, "readwrite", (t) => {
    const store = t.objectStore(STORE_QUEUE);
    for (const r of records) store.put(r);
  });
}

export interface PostResult {
  status: number;
  data: unknown;
  retryAfterSec?: number;
  code?: string;
}

export interface DrainDeps {
  postBatch(items: Array<{ payload: string; scanId: string; capturedAt: string; offlineVerdict?: string }>): Promise<PostResult>;
  /** Per-record fallback when the batch route rejects the whole request (400). */
  postSingle(item: { payload: string; scanId: string; capturedAt: string; offlineVerdict?: string }): Promise<PostResult>;
  now?: () => number;
  onAuthRequired?: (code: string) => void;
  onReconciled?: (record: QueuedScan) => void | Promise<void>;
  /** Called for every record that reached `synced` (clear its local mark). */
  onSynced?: (record: QueuedScan) => void | Promise<void>;
}

export interface DrainResult {
  processed: number;
  synced: number;
  reviewed: number;
  stoppedBy: "auth" | "rate_limit" | "lock" | "nothing" | null;
}

let inProcessDrain = false;

async function withDrainLock<T>(fn: () => Promise<T>, onBusy: () => T): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request("stickets:drain", { ifAvailable: true }, async (lock) => {
      if (!lock) return onBusy();
      return fn();
    }) as Promise<T>;
  }
  if (inProcessDrain) return onBusy();
  inProcessDrain = true;
  try {
    return await fn();
  } finally {
    inProcessDrain = false;
  }
}

const toItem = (r: QueuedScan) => ({
  payload: r.payload,
  scanId: r.scanId,
  capturedAt: r.capturedAt,
  offlineVerdict: r.localVerdict.slice(0, 20),
});

/** One drain pass: claim → POST batch → settle. Cross-tab safe. Never throws. */
export async function drainOnce(deps: DrainDeps): Promise<DrainResult> {
  const now = deps.now ?? (() => Date.now());
  return withDrainLock(
    async () => {
      const result: DrainResult = { processed: 0, synced: 0, reviewed: 0, stoppedBy: null };
      const claimed = await claimDue(now());
      if (claimed.length === 0) return { ...result, stoppedBy: "nothing" };
      result.processed = claimed.length;

      let settled: QueuedScan[] = [];
      let stop: DrainResult["stoppedBy"] = null;

      const res = await deps.postBatch(claimed.map(toItem)).catch(() => ({ status: 0, data: null }) as PostResult);

      if (res.status >= 200 && res.status < 300) {
        const parsed = batchResponseSchema.safeParse(res.data);
        const byId = new Map<string, SettleOutcome>();
        if (parsed.success) {
          for (const item of parsed.data.results) {
            byId.set(item.scanId, "verdict" in item ? { type: "verdict", verdict: item.verdict } : { type: "item_error", ...item.error });
          }
        }
        for (const rec of claimed) {
          const outcome = byId.get(rec.scanId) ?? { type: "http", status: 0 };
          const s = settleRecord(rec, outcome, now());
          settled.push(s.record);
        }
      } else if (res.status === 400) {
        // Something in the batch shape was refused; find out which record by
        // sending them one at a time.
        for (const rec of claimed) {
          const single = await deps.postSingle(toItem(rec)).catch(() => ({ status: 0, data: null }) as PostResult);
          let outcome: SettleOutcome;
          if (single.status >= 200 && single.status < 300) {
            try {
              outcome = { type: "verdict", verdict: parseServerVerdict(single.data) };
            } catch {
              outcome = { type: "http", status: 0 };
            }
          } else {
            outcome = { type: "http", status: single.status, retryAfterSec: single.retryAfterSec, code: single.code };
          }
          const s = settleRecord(rec, outcome, now());
          settled.push(s.record);
          if (s.stop) {
            stop = s.stop;
            break;
          }
        }
        // Anything not reached goes back to pending untouched.
        const done = new Set(settled.map((r) => r.scanId));
        for (const rec of claimed) if (!done.has(rec.scanId)) settled.push({ ...rec, status: "pending", claimedAt: null });
      } else {
        for (const rec of claimed) {
          const s = settleRecord(rec, { type: "http", status: res.status, retryAfterSec: res.retryAfterSec, code: res.code }, now());
          settled.push(s.record);
          if (s.stop) stop = s.stop;
        }
      }

      await putAll(settled);
      for (const rec of settled) {
        if (rec.status === "synced") {
          result.synced += 1;
          await deps.onSynced?.(rec);
        }
        if (rec.status === "needs_review") result.reviewed += 1;
        if (rec.serverResult && (rec.status === "synced" || rec.status === "needs_review")) await deps.onReconciled?.(rec);
      }
      await purgeSynced();
      if (stop === "auth") deps.onAuthRequired?.(res.code ?? "SCANNER_TOKEN_INVALID");
      result.stoppedBy = stop;
      settled = [];
      notifyQueueChanged();
      return result;
    },
    () => ({ processed: 0, synced: 0, reviewed: 0, stoppedBy: "lock" as const })
  );
}
