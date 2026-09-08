import { getMeta, setMeta } from "@/lib/idb";

/**
 * Per-device identity. Several phones may share one scanner access code; the
 * backend attributes every scan (and the 5-minute undo right) to the account
 * AND this id, so "who admitted them" is answerable per phone.
 *
 * Stored in IndexedDB meta with a localStorage mirror: either surviving is
 * enough, and the mirror makes the id available synchronously after the first
 * boot. Never rotated automatically — rotation would orphan queued scans'
 * undo rights.
 */
const LS_KEY = "stickets:device-id";
const META_KEY = "deviceId";
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

let current: string | null = null;

function fromLocalStorage(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && DEVICE_ID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function toLocalStorage(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* private mode — IDB copy or memory copy carries it */
  }
}

export async function initDeviceId(): Promise<string> {
  if (current) return current;
  let id: string | null = null;
  try {
    id = await getMeta<string>(META_KEY);
    if (id && !DEVICE_ID_RE.test(id)) id = null;
  } catch {
    /* IDB unavailable */
  }
  if (!id) id = fromLocalStorage();
  if (!id) id = crypto.randomUUID();
  current = id;
  toLocalStorage(id);
  try {
    await setMeta(META_KEY, id);
  } catch {
    /* best effort */
  }
  return id;
}

/** Synchronous accessor; falls back to the mirror, then mints one (persisted later by initDeviceId). */
export function getDeviceId(): string {
  if (current) return current;
  const mirrored = fromLocalStorage();
  if (mirrored) {
    current = mirrored;
    return mirrored;
  }
  current = crypto.randomUUID();
  toLocalStorage(current);
  return current;
}
