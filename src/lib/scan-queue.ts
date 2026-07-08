/**
 * Offline scan queue (IndexedDB, dependency-free).
 *
 * When the device is offline, scans are stored here and synced to the BFF /scan
 * route when connectivity returns. Records are keyed by a hash of the QR payload
 * so re-scanning the same displayed code doesn't create duplicates, and each
 * carries a stable `scanId` sent to the server so a lost-ACK retry is idempotent
 * end-to-end (the backend can recognize the same scanId — see plan OFF-5).
 *
 * IMPORTANT: this queues admissions made WITHOUT server verification. The UI must
 * present them as "queued / unverified" (never a green "valid"), and the backend's
 * atomic used-flip remains the source of truth on sync.
 */
import type { ScanServerResult } from "@/types/scanner.types";
import { parseScanServerResult } from "@/types/scanner.types";

const DB_NAME = "stickets-scanner";
const DB_VERSION = 1;
const STORE = "scanQueue";

export interface QueuedScan {
  payloadHash: string; // primary key — dedupes re-scans of the same code
  scanId: string;
  payload: string;
  capturedAt: string;
  status: "pending" | "syncing" | "synced" | "failed";
  attempts: number;
  lastError?: string;
  serverResult?: ScanServerResult;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "payloadHash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Add a scan to the queue (idempotent by payload). Returns the queued record. */
export async function enqueueScan(payload: string): Promise<QueuedScan> {
  const payloadHash = await sha256Hex(payload);
  const existing = await tx<QueuedScan | undefined>("readonly", (s) =>
    s.get(payloadHash)
  );
  if (existing) return existing;

  const record: QueuedScan = {
    payloadHash,
    scanId: crypto.randomUUID(),
    payload,
    capturedAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  await tx("readwrite", (s) => s.put(record));
  return record;
}

export async function pendingCount(): Promise<number> {
  const all = await tx<QueuedScan[]>("readonly", (s) => s.getAll());
  return all.filter((r) => r.status === "pending" || r.status === "failed")
    .length;
}

/**
 * Drain the queue: POST each pending/failed record to the BFF and record the
 * server result. Returns the number of records that synced. `poster` performs
 * the same-origin POST (injected so this stays testable and BFF-agnostic).
 */
export async function drainQueue(
  poster: (body: {
    payload: string;
    scanId: string;
  }) => Promise<{ ok: boolean; status: number; data: unknown }>
): Promise<number> {
  const all = await tx<QueuedScan[]>("readonly", (s) => s.getAll());
  const todo = all.filter((r) => r.status === "pending" || r.status === "failed");
  let synced = 0;

  for (const rec of todo) {
    try {
      const res = await poster({ payload: rec.payload, scanId: rec.scanId });
      if (res.ok) {
        rec.status = "synced";
        try {
          rec.serverResult = parseScanServerResult(res.data);
        } catch {
          /* keep synced even if the shape is unexpected */
        }
        synced++;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // A 4xx (except rate-limit) is a permanent rejection — stop retrying.
        rec.status = "failed";
        rec.lastError = `HTTP ${res.status}`;
      } else {
        rec.status = "pending";
        rec.attempts += 1;
        rec.lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      rec.status = "pending";
      rec.attempts += 1;
      rec.lastError = err instanceof Error ? err.message : String(err);
    }
    await tx("readwrite", (s) => s.put(rec));
  }
  return synced;
}

/** Remove synced records (housekeeping). */
export async function purgeSynced(): Promise<void> {
  const all = await tx<QueuedScan[]>("readonly", (s) => s.getAll());
  for (const rec of all.filter((r) => r.status === "synced")) {
    await tx("readwrite", (s) => s.delete(rec.payloadHash));
  }
}
