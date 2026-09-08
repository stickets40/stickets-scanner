"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { EMPTY_TALLY, listShiftEntries, markEntryUndone, resetShift, shiftTally, type ShiftEntry, type ShiftTally } from "@/lib/shift-log";
import {
  acknowledgeConflict,
  listConflicts,
  listStalled,
  retryStalled,
  revertOfflineAdmission,
  type QueuedScan,
} from "@/lib/scan-queue";
import { clearLocalUsed } from "@/lib/manifest";
import { api } from "@/lib/api";
import { requestQueueDrain, SHIFT_CHANGED_EVENT, QUEUE_CHANGED_EVENT } from "@/lib/events";
import { formatTime, now as clockNow } from "@/lib/clock";
import { useQueueStatus } from "@/hooks/use-queue-status";
import type { VerdictKind } from "@/types/verdict.types";
import Sheet from "@/components/ui/sheet";
import Button from "@/components/ui/button";
import { TagPill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";

interface ShiftSheetProps {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

type PillVariant = "admit" | "used" | "wrong-gate" | "invalid" | "pending";

const PILL_BY_KIND: Record<VerdictKind, { variant: PillVariant; label: string }> = {
  success: { variant: "admit", label: "In" },
  success_offline: { variant: "admit", label: "In · offline" },
  admitted_unverified: { variant: "pending", label: "Unverified" },
  already_used: { variant: "used", label: "Used" },
  already_used_offline: { variant: "used", label: "Used · offline" },
  wrong_scanner: { variant: "wrong-gate", label: "Wrong gate" },
  outside_window: { variant: "used", label: "Outside window" },
  invalid: { variant: "invalid", label: "Invalid" },
  authentic_not_in_manifest: { variant: "pending", label: "Not in data" },
  unverifiable: { variant: "pending", label: "Unverifiable" },
  unverifiable_denied: { variant: "invalid", label: "Denied" },
  error: { variant: "pending", label: "Error" },
  undone: { variant: "pending", label: "Undone" },
};

const SERVER_RESULT_LABEL: Record<string, string> = {
  success: "Valid",
  already_used: "Already used",
  wrong_scanner: "Wrong gate",
  invalid: "Invalid",
  outside_window: "Outside window",
};

/**
 * The shift sheet answers: how many are in, what did that last one say, did
 * anything go wrong. Conflicts (offline admissions the server later rejected)
 * are never auto-cleared — a human acknowledges each one.
 */
const ShiftSheetComponent = ({ open, onClose, onChanged }: ShiftSheetProps) => {
  const [tally, setTally] = useState<ShiftTally>(EMPTY_TALLY);
  const [recent, setRecent] = useState<ShiftEntry[]>([]);
  const [conflicts, setConflicts] = useState<QueuedScan[]>([]);
  const [stalled, setStalled] = useState<QueuedScan[]>([]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => clockNow());
  const queue = useQueueStatus();

  const load = useCallback(async () => {
    const [t, r, c, s] = await Promise.all([
      shiftTally().catch(() => EMPTY_TALLY),
      listShiftEntries(30).catch(() => [] as ShiftEntry[]),
      listConflicts().catch(() => [] as QueuedScan[]),
      listStalled().catch(() => [] as QueuedScan[]),
    ]);
    setTally(t);
    setRecent(r);
    setConflicts(c);
    setStalled(s);
    setNowMs(clockNow());
  }, []);

  useEffect(() => {
    if (!open) return;
    setConfirmingReset(false);
    setRowError(null);
    void load();
    const t = setInterval(() => setNowMs(clockNow()), 5000);
    window.addEventListener(SHIFT_CHANGED_EVENT, load);
    window.addEventListener(QUEUE_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(SHIFT_CHANGED_EVENT, load);
      window.removeEventListener(QUEUE_CHANGED_EVENT, load);
    };
  }, [open, load]);

  const handleAcknowledge = async (scanId: string, hintHash?: string) => {
    await acknowledgeConflict(scanId);
    if (hintHash) await clearLocalUsed(hintHash, { serverUsed: true }).catch(() => {});
    onChanged?.();
    await load();
  };

  const handleRevert = async (rec: QueuedScan) => {
    const removed = await revertOfflineAdmission(rec.scanId);
    if (removed?.ticketHint?.h) await clearLocalUsed(removed.ticketHint.h).catch(() => {});
    await markEntryUndone(rec.scanId).catch(() => {});
    onChanged?.();
    await load();
  };

  const handleUndoServer = async (entry: ShiftEntry) => {
    if (!entry.scanLogId || !entry.scanId) return;
    setRowError(null);
    const r = await api.post("scan/undo", { scanLogId: entry.scanLogId });
    if (!r.ok) {
      setRowError(
        r.code === "UNDO_WINDOW_EXPIRED"
          ? "The undo window for that admission has closed."
          : r.code === "UNDO_NOT_OWNER"
            ? "Only the device that admitted them can undo."
            : (r.message ?? "Could not undo.")
      );
      return;
    }
    await markEntryUndone(entry.scanId).catch(() => {});
    onChanged?.();
    await load();
  };

  const handleReset = async () => {
    await resetShift();
    setConfirmingReset(false);
    onChanged?.();
    await load();
  };

  const admittedTotal = tally.admitted + tally.admittedOffline + tally.admittedUnverified - tally.undone;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="This shift"
      description="Counted on this device only — the header shows the venue-wide figure."
      footer={
        confirmingReset ? (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setConfirmingReset(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReset} className="flex-1">
              Clear history
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingReset(true)} className="w-full">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Start a new shift
          </Button>
        )
      }
    >
      <div className="space-y-6">
        {conflicts.length > 0 && (
          <section aria-labelledby="conflicts-heading">
            <h3 id="conflicts-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold text-invalid">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              Needs review ({conflicts.length})
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-ink-muted">
              Admitted without the server, then rejected by it on sync. Someone got in who should not have — or scanned a code this
              device had also just admitted. Acknowledge each one so it is recorded as handled.
            </p>
            <ul className="space-y-2">
              {conflicts.map((c) => {
                const r = c.serverResult;
                const lowSeverity = r?.result === "already_used" && r.sameDevice;
                return (
                  <li
                    key={c.scanId}
                    className={cn("rounded-xl border p-3", lowSeverity ? "border-line bg-surface-2" : "border-invalid/40 bg-invalid/10")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TagPill tag={r ? (SERVER_RESULT_LABEL[r.result] ?? r.result) : "Unverified"} variant={lowSeverity ? "pending" : "invalid"} size="xs" showDot />
                      <span className="tabular text-xs text-ink-muted">{formatTime(c.capturedAt)}</span>
                    </div>
                    <p className="mt-2 text-sm text-ink">{describeConflict(c)}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Device said: {c.localVerdict === "success" ? "in (offline)" : c.localVerdict}
                      {c.ticketHint?.ownerName ? ` · ${c.ticketHint.ownerName}` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(c.scanId, c.ticketHint?.h)}
                      className={cn(
                        "mt-3 min-h-11 w-full rounded-xl border border-line bg-surface-2",
                        "text-sm font-semibold text-ink transition-colors active:bg-line-soft",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      )}
                    >
                      Acknowledge
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="tally-heading">
          <h3 id="tally-heading" className="mb-3 text-sm font-semibold text-ink">
            Tally
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <TallyCell label="Admitted" value={admittedTotal} tone="admit" />
            <TallyCell label="Unverified admits" value={tally.admittedUnverified} tone="pending" />
            <TallyCell label="Already used" value={tally.used} tone="used" />
            <TallyCell label="Wrong gate" value={tally.wrongGate} tone="wrong-gate" />
            <TallyCell label="Outside window" value={tally.outsideWindow} tone="used" />
            <TallyCell label="Invalid / denied" value={tally.invalid + tally.denied} tone="invalid" />
          </div>
          {tally.undone > 0 && <p className="mt-2 text-xs text-ink-muted">{tally.undone} undone (already subtracted).</p>}
          {queue.unverified > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              {queue.unverified} admission{queue.unverified === 1 ? "" : "s"} still waiting to verify with the server.
            </p>
          )}
        </section>

        {stalled.length > 0 && (
          <section aria-labelledby="stalled-heading">
            <h3 id="stalled-heading" className="mb-1 text-sm font-semibold text-used">
              Couldn&apos;t sync ({stalled.length})
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-ink-muted">
              These admissions kept failing to reach the server. Retry when the connection is better, or revert one if it was a mistake.
            </p>
            <ul className="space-y-2">
              {stalled.map((s) => (
                <li key={s.scanId} className="rounded-xl border border-used/40 bg-used/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{s.ticketHint?.ownerName ?? "Unverified admission"}</span>
                    <span className="tabular text-xs text-ink-muted">{formatTime(s.capturedAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {s.status === "failed_permanent" ? `Rejected: ${s.serverError?.code ?? s.lastError ?? "unknown"}` : `${s.attempts} attempts · ${s.lastError ?? "network"}`}
                  </p>
                  {s.status === "stalled" && (
                    <button
                      type="button"
                      onClick={() => handleRevert(s)}
                      className="mt-2 min-h-10 w-full rounded-xl border border-line bg-surface-2 text-sm font-semibold text-ink active:bg-line-soft"
                    >
                      Revert this admission
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {stalled.some((s) => s.status === "stalled") && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={async () => {
                  await retryStalled();
                  requestQueueDrain();
                  await load();
                }}
              >
                Retry all
              </Button>
            )}
          </section>
        )}

        <section aria-labelledby="recent-heading">
          <h3 id="recent-heading" className="mb-3 text-sm font-semibold text-ink">
            Recent
          </h3>
          {rowError && (
            <p role="alert" className="mb-2 text-xs text-danger">
              {rowError}
            </p>
          )}
          {recent.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">
              No scans yet this shift. Verdicts appear here as you scan, so you can re-check one without asking the holder to queue again.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {recent.map((e, i) => {
                const pill = PILL_BY_KIND[e.kind] ?? PILL_BY_KIND.error;
                const primary = e.ownerName ?? e.detail ?? pill.label;
                const secondary = [e.ticketTypeName, e.ownerName && e.detail ? e.detail : null, e.offline ? "offline" : null]
                  .filter(Boolean)
                  .join(" · ");
                const canUndo =
                  !e.undone && e.kind === "success" && e.scanLogId && e.undoableUntil && Date.parse(e.undoableUntil) > nowMs;
                return (
                  <li key={e.seq ?? i} className={cn("flex items-center justify-between gap-3 py-2.5", e.undone && "opacity-60")}>
                    <div className="min-w-0">
                      <p className={cn("truncate text-sm font-medium text-ink", e.undone && "line-through")}>{primary}</p>
                      {secondary && <p className="truncate text-xs text-ink-muted">{secondary}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canUndo && (
                        <button
                          type="button"
                          onClick={() => handleUndoServer(e)}
                          aria-label="Undo this admission"
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-ink active:bg-line-soft"
                        >
                          <Undo2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      <TagPill tag={e.undone ? "Undone" : pill.label} variant={e.undone ? "pending" : pill.variant} size="xs" />
                      <span className="tabular w-11 text-right text-xs text-ink-muted">{formatTime(e.at)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
};

function TallyCell({ label, value, tone }: { label: string; value: number; tone: PillVariant }) {
  const toneClass = {
    admit: "text-admit",
    used: "text-used",
    "wrong-gate": "text-wrong-gate",
    invalid: "text-invalid",
    pending: "text-ink-muted",
  }[tone];
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-3">
      <p className={cn("tabular text-2xl font-bold", toneClass)}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-ink-muted">{label}</p>
    </div>
  );
}

function describeConflict(c: QueuedScan): string {
  const r = c.serverResult;
  const who = c.ticketHint?.ownerName ?? "Someone";
  if (!r) return "Could not be verified with the server.";
  switch (r.result) {
    case "already_used":
      return r.sameDevice
        ? `${who} was admitted twice from this device — a double scan, no action needed.`
        : `${r.ticket.ownerName} was admitted offline, but this ticket had already been used${r.firstScannedBy ? ` at ${r.firstScannedBy.scannerName}` : ""}.`;
    case "wrong_scanner":
      return `${who} was admitted offline, but this ticket belongs to ${r.correctScannerNames.join(" / ") || "another entrance"}.`;
    case "outside_window":
      return `${who} was admitted offline outside the scan window.`;
    case "invalid":
      return `${who} was admitted offline, but the ticket is not valid. ${r.message}`;
    default:
      return "Admitted offline and later rejected.";
  }
}

export default ShiftSheetComponent;
