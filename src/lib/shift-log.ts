/**
 * Device-local shift history.
 *
 * Answers the questions asked at every door: "how many have we let in?" and
 * "what did that last one say?". SCOPE: what THIS DEVICE scanned this shift —
 * never venue-wide (that is the live-stats header). The tally lives in the
 * counters store and is incremented in the same transaction as the entry, so
 * it never undercounts once the 200-entry list has rolled over.
 */
import type { VerdictKind } from "@/types/verdict.types";
import { reqToPromise, STORE_COUNTERS, STORE_SHIFT, withTx } from "@/lib/idb";
import { notifyShiftChanged } from "@/lib/events";

const MAX_ENTRIES = 200;
const COUNTER_KEY = "shift";

export interface ShiftEntry {
  seq?: number;
  at: string;
  kind: VerdictKind;
  scanId?: string;
  ownerName?: string;
  ticketTypeName?: string;
  detail?: string;
  /** Captured without server verification (offline / fallback / unverified admit). */
  offline?: boolean;
  /** Server admission id — what an Undo needs. */
  scanLogId?: string;
  undoableUntil?: string;
  undone?: boolean;
}

export interface ShiftTally {
  admitted: number;
  admittedOffline: number;
  admittedUnverified: number;
  used: number;
  wrongGate: number;
  outsideWindow: number;
  invalid: number;
  denied: number;
  undone: number;
  errors: number;
}

export const EMPTY_TALLY: ShiftTally = {
  admitted: 0,
  admittedOffline: 0,
  admittedUnverified: 0,
  used: 0,
  wrongGate: 0,
  outsideWindow: 0,
  invalid: 0,
  denied: 0,
  undone: 0,
  errors: 0,
};

type Counters = { key: string } & Partial<Record<VerdictKind | "undone", number>>;

function tallyFromCounters(c: Counters | undefined): ShiftTally {
  const n = (k: VerdictKind | "undone") => c?.[k] ?? 0;
  return {
    admitted: n("success"),
    admittedOffline: n("success_offline"),
    admittedUnverified: n("admitted_unverified"),
    used: n("already_used") + n("already_used_offline"),
    wrongGate: n("wrong_scanner"),
    outsideWindow: n("outside_window"),
    invalid: n("invalid"),
    denied: n("unverifiable_denied"),
    undone: n("undone"),
    errors: n("error"),
  };
}

/** Append one verdict and bump its counter in ONE transaction; trims past the cap. */
export async function appendShiftEntry(entry: Omit<ShiftEntry, "seq">): Promise<void> {
  await withTx([STORE_SHIFT, STORE_COUNTERS], "readwrite", async (t) => {
    const shift = t.objectStore(STORE_SHIFT);
    const counters = t.objectStore(STORE_COUNTERS);
    shift.add(entry);
    const current = ((await reqToPromise(counters.get(COUNTER_KEY))) as Counters | undefined) ?? { key: COUNTER_KEY };
    current[entry.kind] = (current[entry.kind] ?? 0) + 1;
    counters.put(current);
    const count = await reqToPromise(shift.count());
    if (count > MAX_ENTRIES) {
      const excess = count - MAX_ENTRIES;
      await new Promise<void>((resolve, reject) => {
        let removed = 0;
        const req = shift.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || removed >= excess) return resolve();
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }
  });
  notifyShiftChanged();
}

/** Flag an admission as undone (counter `undone` +1); the entry stays for the record. */
export async function markEntryUndone(scanId: string): Promise<void> {
  await withTx([STORE_SHIFT, STORE_COUNTERS], "readwrite", async (t) => {
    const shift = t.objectStore(STORE_SHIFT);
    const all = (await reqToPromise(shift.getAll())) as ShiftEntry[];
    const target = all.find((e) => e.scanId === scanId && !e.undone);
    if (!target) return;
    shift.put({ ...target, undone: true });
    const counters = t.objectStore(STORE_COUNTERS);
    const current = ((await reqToPromise(counters.get(COUNTER_KEY))) as Counters | undefined) ?? { key: COUNTER_KEY };
    current.undone = (current.undone ?? 0) + 1;
    counters.put(current);
  });
  notifyShiftChanged();
}

/** Most recent first — the order an operator scans the list in. */
export async function listShiftEntries(limit = 20): Promise<ShiftEntry[]> {
  const all = (await withTx(STORE_SHIFT, "readonly", (t) => reqToPromise(t.objectStore(STORE_SHIFT).getAll()))) as ShiftEntry[];
  return all.slice(-limit).reverse();
}

export async function shiftTally(): Promise<ShiftTally> {
  const c = (await withTx(STORE_COUNTERS, "readonly", (t) => reqToPromise(t.objectStore(STORE_COUNTERS).get(COUNTER_KEY)))) as
    | Counters
    | undefined;
  return tallyFromCounters(c);
}

/** Clear the history — an explicit "start of shift" action, never automatic. */
export async function resetShift(): Promise<void> {
  await withTx([STORE_SHIFT, STORE_COUNTERS], "readwrite", (t) => {
    t.objectStore(STORE_SHIFT).clear();
    t.objectStore(STORE_COUNTERS).delete(COUNTER_KEY);
  });
  notifyShiftChanged();
}
