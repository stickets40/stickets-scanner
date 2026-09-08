/**
 * IndexedDB v3 — one database, one version, every store the scanner keeps:
 *
 *   scanQueue        keyPath scanId (offline admissions awaiting the server)
 *   manifestTickets  keyPath h      (this event's tickets, hashed, for offline checks)
 *   meta             keyPath key    (manifest header, device id, clock skew, …)
 *   counters         keyPath key    (shift tally — never undercounts past the list cap)
 *   shiftLog         keyPath seq    (last 200 verdicts on this device)
 *
 * v2 → v3 migrates the old payloadHash-keyed queue to scanId keys INSIDE the
 * upgrade transaction (no awaits — an awaited promise closes it). A device that
 * cannot open IndexedDB at all (private mode, quota, corruption) is detected by
 * probeIdb() and runs live-only with a persistent banner.
 */
const DB_NAME = "stickets-scanner";
const DB_VERSION = 3;

export const STORE_QUEUE = "scanQueue";
export const STORE_MANIFEST = "manifestTickets";
export const STORE_META = "meta";
export const STORE_COUNTERS = "counters";
export const STORE_SHIFT = "shiftLog";

let cached: Promise<IDBDatabase> | null = null;

interface LegacyQueued {
  payloadHash: string;
  scanId: string;
  payload: string;
  capturedAt: string;
  status: string;
  attempts?: number;
  serverResult?: unknown;
  needsAuth?: boolean;
}

function createQueueStore(db: IDBDatabase): IDBObjectStore {
  const store = db.createObjectStore(STORE_QUEUE, { keyPath: "scanId" });
  store.createIndex("status", "status", { unique: false });
  store.createIndex("capturedAt", "capturedAt", { unique: false });
  store.createIndex("payloadHash", "payloadHash", { unique: false });
  store.createIndex("status_next", ["status", "nextAttemptAt"], { unique: false });
  return store;
}

/** v2 record → v3 record. `synced` rows are dropped (the server already knows). */
export function migrateLegacyQueued(rec: LegacyQueued, seq: number): Record<string, unknown> | null {
  if (rec.status === "synced") return null;
  const status = rec.status === "needs_review" ? "needs_review" : "pending";
  return {
    scanId: rec.scanId,
    payload: rec.payload,
    payloadHash: rec.payloadHash,
    capturedAt: rec.capturedAt,
    kind: "unverified_admit",
    status,
    attempts: rec.attempts ?? 0,
    nextAttemptAt: 0,
    claimedAt: null,
    seq,
    localVerdict: "queued",
    serverResult: rec.serverResult,
    needsAuth: rec.needsAuth,
  };
}

function upgrade(req: IDBOpenDBRequest, event: IDBVersionChangeEvent): void {
  const db = req.result;
  const tx = req.transaction;
  if (!tx) return;
  const oldVersion = event.oldVersion;

  if (oldVersion < 3 && db.objectStoreNames.contains(STORE_QUEUE)) {
    const oldStore = tx.objectStore(STORE_QUEUE);
    const legacy: LegacyQueued[] = [];
    const cursorReq = oldStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        legacy.push(cursor.value as LegacyQueued);
        cursor.continue();
        return;
      }
      db.deleteObjectStore(STORE_QUEUE);
      const store = createQueueStore(db);
      legacy
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .forEach((rec, i) => {
          const migrated = migrateLegacyQueued(rec, i + 1);
          if (migrated) store.put(migrated);
        });
    };
  } else if (!db.objectStoreNames.contains(STORE_QUEUE)) {
    createQueueStore(db);
  }

  if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
    const m = db.createObjectStore(STORE_MANIFEST, { keyPath: "h" });
    m.createIndex("gen", "gen", { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
  if (!db.objectStoreNames.contains(STORE_COUNTERS)) db.createObjectStore(STORE_COUNTERS, { keyPath: "key" });
  if (!db.objectStoreNames.contains(STORE_SHIFT)) {
    db.createObjectStore(STORE_SHIFT, { keyPath: "seq", autoIncrement: true });
  } else if (oldVersion < 3) {
    // Seed the tally counters from the surviving entries so the number the
    // operator has been watching does not reset on upgrade.
    const all = tx.objectStore(STORE_SHIFT).getAll();
    all.onsuccess = () => {
      const tally: Record<string, number> = {};
      for (const e of all.result as Array<{ result?: string }>) {
        if (e.result) tally[e.result] = (tally[e.result] ?? 0) + 1;
      }
      tx.objectStore(STORE_COUNTERS).put({ key: "shift", ...tally });
    };
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (cached) return cached;
  cached = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = (event) => upgrade(req, event);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded (or the user cleared data): drop the handle so the
      // next call reopens instead of failing forever.
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      db.onclose = () => {
        cached = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/** "ok" when the database opens (and stays open), else "unavailable" → live-only mode. */
export async function probeIdb(): Promise<"ok" | "unavailable"> {
  try {
    await openDb();
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Run `fn` inside one transaction spanning `stores`; resolves when it commits. */
export async function withTx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let failed: unknown = null;
    const t = db.transaction(stores, mode);
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(failed ?? t.error ?? new Error("IndexedDB transaction aborted"));
    Promise.resolve()
      .then(() => fn(t))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        failed = err;
        try {
          t.abort();
        } catch {
          /* already finished */
        }
      });
  });
}

/** Run a single request against one store and resolve with its result. */
export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return withTx(store, mode, (t) => reqToPromise(fn(t.objectStore(store))));
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await tx<{ key: string; value: T } | undefined>(STORE_META, "readonly", (s) => s.get(key));
  return row?.value ?? null;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await tx(STORE_META, "readwrite", (s) => s.put({ key, value }));
}

export async function deleteMeta(key: string): Promise<void> {
  await tx(STORE_META, "readwrite", (s) => s.delete(key));
}

/**
 * Ask the browser not to evict our data under storage pressure. Chrome grants
 * it silently for installed PWAs; Safari grants it after the user has engaged
 * with the site. Best-effort: the app must work either way.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Test helper: close and forget the cached connection so a deleteDatabase can proceed. */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  try {
    (await cached).close();
  } catch {
    /* ignore */
  }
  cached = null;
}
