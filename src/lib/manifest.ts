import { manifestPageSchema, type ManifestPage } from "@/types/verdict.types";
import {
  deleteMeta,
  getMeta,
  reqToPromise,
  setMeta,
  STORE_MANIFEST,
  withTx,
} from "@/lib/idb";
import { now as clockNow } from "@/lib/clock";
import { notifyManifestChanged } from "@/lib/events";

/**
 * The on-device manifest: every issued ticket of the scanner's event as an
 * opaque 22-char hash plus type / qr version / status / holder name, and the
 * header the offline engine needs (public key, scan window, allowed types).
 *
 * Full sync on first use, on an event change or when the last full sync is
 * older than 12 h; delta sync (rows changed since the last sync's server time)
 * every minute while online. Local admissions mark the row `localUsedAt` so a
 * second offline presentation reads as a duplicate before the server knows.
 */
export interface ManifestMeta {
  eventId: string;
  eventName: string;
  generatedAt: string;
  publicKey: string;
  window: { opensAt: string; closesAt: string };
  ticketTypes: Array<{ id: number; name: string; seated: boolean; sectionNum: number | null }>;
  allowedTicketTypeIds: number[];
  entryInstructions: string | null;
  /** Generation of the last FULL sync; rows from older generations are swept. */
  gen: number;
  count: number;
  lastFullAt: string;
  /** Server time at the START of the last sync — the next delta's `since`. */
  syncedAt: string;
  lastDeltaAt: string | null;
}

export interface ManifestRow {
  h: string;
  tt: number;
  v: number;
  s: "valid" | "used";
  n: string;
  gen: number;
  localUsedAt?: string | null;
  localScanId?: string | null;
  localDeviceId?: string | null;
}

export type EffectiveStatus = "valid" | "used" | "used_local" | "missing";

export interface LookupResult {
  entry: ManifestRow | null;
  meta: ManifestMeta | null;
  effectiveStatus: EffectiveStatus;
  /** How old the offline data is (ms since the last sync's server time). */
  ageMs: number;
}

export interface ManifestFetchers {
  fetchPage(cursor: string | null): Promise<ManifestPage>;
  fetchDelta(since: string, cursor: string | null): Promise<ManifestPage>;
}

export class ManifestSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "ManifestSyncError";
  }
}

const META_KEY = "manifest";
export const FULL_SYNC_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const WRITE_CHUNK = 1000;

export async function getManifestMeta(): Promise<ManifestMeta | null> {
  return getMeta<ManifestMeta>(META_KEY);
}

export function manifestAgeMs(meta: ManifestMeta | null, nowMs = clockNow()): number {
  if (!meta) return Number.POSITIVE_INFINITY;
  const t = Date.parse(meta.lastDeltaAt ?? meta.syncedAt);
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : Number.POSITIVE_INFINITY;
}

/** <10 min fresh, <60 min warn, else stale. */
export function manifestAgeLabel(ageMs: number): "ok" | "warn" | "stale" {
  if (ageMs < 10 * 60 * 1000) return "ok";
  if (ageMs < 60 * 60 * 1000) return "warn";
  return "stale";
}

function headerOf(page: ManifestPage): Omit<ManifestMeta, "gen" | "count" | "lastFullAt" | "syncedAt" | "lastDeltaAt"> {
  return {
    eventId: page.eventId,
    eventName: page.eventName,
    generatedAt: page.generatedAt,
    publicKey: page.publicKey,
    window: page.window,
    ticketTypes: page.ticketTypes,
    allowedTicketTypeIds: page.allowedTicketTypeIds,
    entryInstructions: page.entryInstructions,
  };
}

/**
 * Merge a server row over the stored one. A local admission mark survives
 * while the server still says `valid` (it has not heard about the scan yet)
 * and is dropped once the server itself reports `used`.
 */
function mergeRow(existing: ManifestRow | undefined, incoming: ManifestPage["tickets"][number], gen: number): ManifestRow {
  const keepLocal = existing?.localUsedAt && incoming.s === "valid";
  return {
    h: incoming.h,
    tt: incoming.tt,
    v: incoming.v,
    s: incoming.s,
    n: incoming.n,
    gen,
    localUsedAt: keepLocal ? existing!.localUsedAt : null,
    localScanId: keepLocal ? existing!.localScanId ?? null : null,
    localDeviceId: keepLocal ? existing!.localDeviceId ?? null : null,
  };
}

async function writeRows(rows: ManifestPage["tickets"], gen: number): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    inserted += await withTx(STORE_MANIFEST, "readwrite", async (t) => {
      const store = t.objectStore(STORE_MANIFEST);
      let fresh = 0;
      for (const row of chunk) {
        const existing = (await reqToPromise(store.get(row.h))) as ManifestRow | undefined;
        if (!existing) fresh += 1;
        store.put(mergeRow(existing, row, existing?.gen ?? gen));
      }
      return fresh;
    });
  }
  return inserted;
}

async function sweepOlderThan(gen: number): Promise<void> {
  await withTx(STORE_MANIFEST, "readwrite", async (t) => {
    const index = t.objectStore(STORE_MANIFEST).index("gen");
    await new Promise<void>((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.upperBound(gen, true));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/** Full sync: page through everything under a new generation, then drop rows the server no longer lists. */
export async function syncManifestFull(f: ManifestFetchers): Promise<ManifestMeta> {
  const previous = await getManifestMeta();
  const gen = (previous?.gen ?? 0) + 1;
  let cursor: string | null = null;
  let count = 0;
  let header: ReturnType<typeof headerOf> | null = null;
  let syncedAt: string | null = null;
  let guard = 0;
  do {
    const page = manifestPageSchema.parse(await f.fetchPage(cursor));
    if (!header) {
      header = headerOf(page);
      syncedAt = page.serverTime;
    }
    // Every row of this sync carries the new generation (rows keep their
    // local marks through mergeRow, but ALWAYS move to `gen`).
    await withTx(STORE_MANIFEST, "readwrite", async (t) => {
      const store = t.objectStore(STORE_MANIFEST);
      for (const row of page.tickets) {
        const existing = (await reqToPromise(store.get(row.h))) as ManifestRow | undefined;
        store.put(mergeRow(existing, row, gen));
      }
    });
    count += page.tickets.length;
    cursor = page.cursor;
    if (++guard > 10_000) throw new ManifestSyncError("Manifest paging did not terminate", "PAGING");
  } while (cursor);

  await sweepOlderThan(gen);
  const meta: ManifestMeta = {
    ...header!,
    gen,
    count,
    lastFullAt: new Date(clockNow()).toISOString(),
    syncedAt: syncedAt!,
    lastDeltaAt: null,
  };
  await setMeta(META_KEY, meta);
  notifyManifestChanged();
  return meta;
}

/** Delta sync: rows changed since the last sync's server time; header refreshed too. */
export async function syncManifestDelta(f: ManifestFetchers): Promise<ManifestMeta> {
  const meta = await getManifestMeta();
  if (!meta) return syncManifestFull(f);
  let cursor: string | null = null;
  let header: ReturnType<typeof headerOf> | null = null;
  let syncedAt: string | null = null;
  let added = 0;
  let guard = 0;
  try {
    do {
      const page = manifestPageSchema.parse(await f.fetchDelta(meta.syncedAt, cursor));
      if (!header) {
        header = headerOf(page);
        syncedAt = page.serverTime;
      }
      added += await writeRows(page.tickets, meta.gen);
      cursor = page.cursor;
      if (++guard > 10_000) throw new ManifestSyncError("Manifest paging did not terminate", "PAGING");
    } while (cursor);
  } catch (error) {
    // The backend refuses deltas older than 30 days; a full sync is the answer.
    if (error instanceof ManifestSyncError && error.code === "DELTA_TOO_OLD") return syncManifestFull(f);
    throw error;
  }
  const next: ManifestMeta = {
    ...meta,
    ...header!,
    count: meta.count + added,
    syncedAt: syncedAt!,
    lastDeltaAt: new Date(clockNow()).toISOString(),
  };
  await setMeta(META_KEY, next);
  notifyManifestChanged();
  return next;
}

/**
 * Bring the manifest up to date for `eventId`: full when there is none, it is
 * for another event, or the last full sync is over 12 h old; otherwise delta.
 */
export async function ensureManifest(
  f: ManifestFetchers,
  eventId: string,
  opts: { force?: "full" | "delta"; nowMs?: number } = {}
): Promise<ManifestMeta> {
  const meta = await getManifestMeta();
  const nowMs = opts.nowMs ?? clockNow();
  const fullAge = meta ? nowMs - Date.parse(meta.lastFullAt) : Number.POSITIVE_INFINITY;
  const needsFull =
    opts.force === "full" || !meta || meta.eventId !== eventId || !Number.isFinite(fullAge) || fullAge > FULL_SYNC_MAX_AGE_MS;
  if (needsFull) {
    if (meta && meta.eventId !== eventId) await clearManifest();
    return syncManifestFull(f);
  }
  return syncManifestDelta(f);
}

export async function lookupTicket(h: string, nowMs = clockNow()): Promise<LookupResult> {
  const [meta, entry] = await Promise.all([
    getManifestMeta(),
    withTx(STORE_MANIFEST, "readonly", (t) => reqToPromise(t.objectStore(STORE_MANIFEST).get(h))) as Promise<ManifestRow | undefined>,
  ]);
  const effectiveStatus: EffectiveStatus = !entry
    ? "missing"
    : entry.s === "used"
      ? "used"
      : entry.localUsedAt
        ? "used_local"
        : "valid";
  return { entry: entry ?? null, meta, effectiveStatus, ageMs: manifestAgeMs(meta, nowMs) };
}

export async function markUsedLocally(
  h: string,
  mark: { deviceId: string; scanId: string; at: string }
): Promise<void> {
  await withTx(STORE_MANIFEST, "readwrite", async (t) => {
    const store = t.objectStore(STORE_MANIFEST);
    const existing = (await reqToPromise(store.get(h))) as ManifestRow | undefined;
    if (!existing) return;
    store.put({ ...existing, localUsedAt: mark.at, localScanId: mark.scanId, localDeviceId: mark.deviceId });
  });
}

/** After the server accepted (or the operator reverted) a local admission. */
export async function clearLocalUsed(h: string, opts: { serverUsed?: boolean } = {}): Promise<void> {
  await withTx(STORE_MANIFEST, "readwrite", async (t) => {
    const store = t.objectStore(STORE_MANIFEST);
    const existing = (await reqToPromise(store.get(h))) as ManifestRow | undefined;
    if (!existing) return;
    store.put({
      ...existing,
      s: opts.serverUsed ? "used" : existing.s,
      localUsedAt: null,
      localScanId: null,
      localDeviceId: null,
    });
  });
}

/** Offline read-only lookup by holder name (case-insensitive contains). */
export async function searchManifestByName(query: string, limit = 10): Promise<ManifestRow[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = (await withTx(STORE_MANIFEST, "readonly", (t) => reqToPromise(t.objectStore(STORE_MANIFEST).getAll()))) as ManifestRow[];
  return all
    .filter((r) => r.n.toLowerCase().includes(q))
    .sort((a, b) => a.n.localeCompare(b.n))
    .slice(0, limit);
}

export async function manifestCounts(): Promise<{ total: number; used: number; usedLocal: number }> {
  const all = (await withTx(STORE_MANIFEST, "readonly", (t) => reqToPromise(t.objectStore(STORE_MANIFEST).getAll()))) as ManifestRow[];
  let used = 0;
  let usedLocal = 0;
  for (const r of all) {
    if (r.s === "used") used += 1;
    else if (r.localUsedAt) usedLocal += 1;
  }
  return { total: all.length, used, usedLocal };
}

export async function clearManifest(): Promise<void> {
  await withTx(STORE_MANIFEST, "readwrite", (t) => reqToPromise(t.objectStore(STORE_MANIFEST).clear()));
  await deleteMeta(META_KEY);
  notifyManifestChanged();
}
