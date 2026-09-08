"use client";

import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  Clock,
  CloudOff,
  HelpCircle,
  RotateCcw,
  ShieldQuestion,
  Undo2,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Verdict } from "@/types/verdict.types";
import { CHOICE_KINDS } from "@/types/verdict.types";
import { formatDuration, formatElapsed, formatTime, now as clockNow } from "@/lib/clock";
import { manifestAgeLabel } from "@/lib/manifest";
import { cn } from "@/lib/cn";
import { typography } from "@/shared/design-token/typography";

interface ScanResultProps {
  verdict: Verdict;
  busy: boolean;
  onDismiss: () => void;
  onChoose: (decision: "admit" | "deny") => void;
  onTryOnline: () => void;
  onUndo: () => Promise<string | null>;
}

/**
 * THE VERDICT. The whole viewport becomes the answer: colour first (readable
 * peripherally), one word to confirm, icon + tone + haptic for colour-blind
 * operators and loud rooms. Detail is demoted to a supporting line.
 *
 * Offline outcomes are labelled as such and choice cards (the device cannot
 * decide alone) stay up until the operator taps a decision — the backdrop does
 * not dismiss them.
 */
type Tone = "admit" | "used" | "wrong-gate" | "invalid" | "pending";

const TONE_CLASSES: Record<Tone, { bg: string; ink: string }> = {
  admit: { bg: "bg-admit", ink: "text-admit-ink" },
  used: { bg: "bg-used", ink: "text-used-ink" },
  "wrong-gate": { bg: "bg-wrong-gate", ink: "text-wrong-gate-ink" },
  invalid: { bg: "bg-invalid", ink: "text-invalid-ink" },
  pending: { bg: "bg-pending", ink: "text-pending-ink" },
};

interface Presentation {
  tone: Tone;
  word: string;
  tag?: string;
  Icon: LucideIcon;
  primary: string;
  secondary?: string;
}

function invalidWord(code: string): string {
  switch (code) {
    case "STALE_QR":
      return "STALE QR";
    case "ORDER_NOT_SETTLED":
      return "PAYMENT PENDING";
    case "LEGACY_FORMAT_REJECTED":
      return "OLD FORMAT";
    case "WRONG_EVENT":
      return "WRONG EVENT";
    default:
      return "NO";
  }
}

function ageWords(ageMs: number): string {
  const label = manifestAgeLabel(ageMs);
  const age = Number.isFinite(ageMs) ? formatDuration(ageMs) : "unknown";
  return label === "ok" ? `offline data ${age} old` : `offline data ${age} old — ${label === "warn" ? "sync soon" : "STALE"}`;
}

export function presentVerdict(v: Verdict, nowMs = clockNow()): Presentation {
  switch (v.kind) {
    case "success":
      return {
        tone: "admit",
        word: "IN",
        tag: v.server.replayed ? "Already recorded" : undefined,
        Icon: Check,
        primary: v.ticket.ownerName,
        secondary: `${v.ticket.ticketTypeName}${v.ticket.seatInfo ? ` · Section ${v.ticket.seatInfo.section}` : ""}`,
      };
    case "success_offline":
      return {
        tone: "admit",
        word: "IN",
        tag: "OFFLINE",
        Icon: Check,
        primary: v.ticket.ownerName,
        secondary: `${v.ticket.ticketTypeName} · verified from ${ageWords(v.manifestAgeMs)}. Will sync when connected.`,
      };
    case "already_used": {
      if (v.server.sameDevice && (v.server.secondsAgo ?? Infinity) <= 120) {
        return {
          tone: "pending",
          word: "DOUBLE SCAN",
          Icon: CheckCheck,
          primary: v.ticket.ownerName,
          secondary: `You scanned this ${v.server.secondsAgo ?? 0}s ago — already admitted. No action needed.`,
        };
      }
      const by = v.server.firstScannedBy?.scannerName;
      const firstUsedAt = v.server.ticket.firstUsedAt;
      const when = firstUsedAt ? `${formatElapsed(firstUsedAt, nowMs)} · ${formatTime(firstUsedAt)}` : "earlier";
      return {
        tone: "used",
        word: "USED",
        tag: v.server.replayed ? "Already recorded" : undefined,
        Icon: RotateCcw,
        primary: v.ticket.ownerName,
        secondary: `Admitted ${when}${by ? ` at ${by}` : ""}`,
      };
    }
    case "already_used_offline":
      return {
        tone: v.sameDevice ? "pending" : "used",
        word: v.sameDevice ? "DOUBLE SCAN" : "USED",
        tag: "OFFLINE",
        Icon: v.sameDevice ? CheckCheck : RotateCcw,
        primary: v.ticket.ownerName,
        secondary: v.sameDevice
          ? `You admitted this one ${v.usedAt ? formatElapsed(v.usedAt, nowMs) : "just now"} on this device.`
          : `Marked used in ${ageWords(v.manifestAgeMs)}.`,
      };
    case "wrong_scanner":
      return {
        tone: "wrong-gate",
        word: "WRONG GATE",
        tag: v.source === "offline" ? "OFFLINE" : undefined,
        Icon: ArrowRightLeft,
        primary: v.correctScannerNames.length ? `Send to ${v.correctScannerNames.join(" or ")}` : "Not this entrance",
        secondary:
          v.correctScannerNames.length
            ? (v.message ?? "Their ticket is valid but assigned to a different entrance.")
            : "Their ticket is valid but not for this gate. Check with your supervisor for the right entrance.",
      };
    case "outside_window":
      return {
        tone: "used",
        word: v.reason === "too_early" ? "TOO EARLY" : "ENDED",
        tag: v.source === "offline" ? "OFFLINE" : undefined,
        Icon: Clock,
        primary: v.ticket?.ownerName ?? (v.reason === "too_early" ? "Scanning has not opened yet" : "Scanning has closed"),
        secondary:
          v.reason === "too_early"
            ? `Ticket is valid. Scanning opens at ${formatTime(v.opensAt)}. Not consumed.`
            : `Scanning closed at ${formatTime(v.closesAt)}. Not consumed — ask a supervisor.`,
      };
    case "invalid":
      return { tone: "invalid", word: invalidWord(v.code), Icon: X, primary: v.message };
    case "authentic_not_in_manifest":
      return {
        tone: "pending",
        word: "VALID TICKET",
        tag: "NOT IN OFFLINE DATA",
        Icon: ShieldQuestion,
        primary: "Genuine ticket for this event, but not in this device's offline data.",
        secondary: `${ageWords(v.manifestAgeMs)}. Likely registered after the last sync — or already changed hands.`,
      };
    case "unverifiable":
      return {
        tone: "pending",
        word: "CAN'T VERIFY",
        Icon: HelpCircle,
        primary:
          v.reason === "legacy_format"
            ? "Older QR format — it can only be checked online."
            : v.reason === "no_manifest"
              ? "No offline data on this device yet."
              : v.reason === "idb_unavailable"
                ? "Offline storage is unavailable on this device."
                : "Offline checks are switched off.",
        secondary: "Decide with your supervisor's guidance, or try online.",
      };
    case "admitted_unverified":
      return { tone: "pending", word: "ADMITTED", tag: "UNVERIFIED", Icon: CloudOff, primary: "Admitted without verification.", secondary: `Captured ${formatTime(v.capturedAt)}. It will be checked when the connection returns.` };
    case "unverifiable_denied":
      return { tone: "invalid", word: "DENIED", Icon: X, primary: "Turned away — could not be verified." };
    case "error":
      return { tone: "pending", word: "PENDING", Icon: WifiOff, primary: v.message, secondary: "This is a device or connection problem, not a bad ticket. Scan again." };
    case "undone":
      return { tone: "pending", word: "UNDONE", Icon: Undo2, primary: "Admission reverted.", secondary: "The ticket can be scanned again." };
  }
}

const ScanResultComponent = ({ verdict, busy, onDismiss, onChoose, onTryOnline, onUndo }: ScanResultProps) => {
  const p = presentVerdict(verdict);
  const { bg, ink } = TONE_CLASSES[p.tone];
  const isChoice = CHOICE_KINDS.has(verdict.kind);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoLeftMs, setUndoLeftMs] = useState<number | null>(null);

  const undoable =
    verdict.kind === "success" || verdict.kind === "success_offline" || verdict.kind === "admitted_unverified";

  useEffect(() => {
    if (verdict.kind !== "success") {
      setUndoLeftMs(null);
      return;
    }
    const until = Date.parse(verdict.server.undoableUntil);
    const tick = () => setUndoLeftMs(Math.max(0, until - clockNow()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [verdict]);

  const canUndo = undoable && (verdict.kind !== "success" || (undoLeftMs ?? 0) > 0);

  const handleUndo = async () => {
    setUndoing(true);
    setUndoError(null);
    const err = await onUndo();
    setUndoing(false);
    if (err) setUndoError(err);
  };

  return (
    <div
      className={cn("fixed inset-0 z-40 flex flex-col animate-verdict-flood no-select", bg, ink)}
      onClick={() => {
        if (!isChoice && !busy) onDismiss();
      }}
      role="status"
      aria-live="assertive"
    >
      <div
        className="flex flex-1 flex-col px-6 animate-verdict-content"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
        }}
      >
        <div className="flex flex-1 flex-col justify-center">
          <div className="mb-4 flex items-center gap-3">
            <p.Icon className="h-14 w-14 shrink-0" strokeWidth={3} aria-hidden="true" />
            {p.tag && (
              <span className="rounded-full border-2 border-current/40 px-3 py-1 text-xs font-bold tracking-wide">{p.tag}</span>
            )}
          </div>
          <h1
            className="leading-[0.92] tracking-[-0.03em]"
            style={{ fontSize: p.word.length > 8 ? "3rem" : typography.fontSize.verdict, fontWeight: typography.fontWeight.bold }}
          >
            {p.word}
          </h1>
          <div className="mt-6 space-y-3">
            <p className="text-xl font-semibold leading-snug text-balance">{p.primary}</p>
            {p.secondary && <p className="max-w-[38ch] text-base leading-relaxed opacity-80">{p.secondary}</p>}
          </div>
        </div>

        {isChoice ? (
          <div className="mt-8 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            {(verdict.kind === "authentic_not_in_manifest" || verdict.kind === "unverifiable") && verdict.canTryOnline && (
              <button
                type="button"
                disabled={busy}
                onClick={onTryOnline}
                className="min-h-14 w-full rounded-2xl bg-white/15 text-base font-semibold backdrop-blur-sm transition-opacity active:opacity-70 disabled:opacity-50"
              >
                {busy ? "Checking…" : "Try online"}
              </button>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose("deny")}
                className="min-h-14 flex-1 rounded-2xl border-2 border-current/30 text-base font-semibold transition-opacity active:opacity-70 disabled:opacity-50"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose("admit")}
                className="min-h-14 flex-1 rounded-2xl bg-admit text-base font-semibold text-admit-ink transition-opacity active:opacity-70 disabled:opacity-50"
              >
                Admit unverified
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            {undoError && (
              <p role="alert" className="text-sm font-medium opacity-90">
                {undoError}
              </p>
            )}
            <div className="flex gap-2">
              {canUndo && (
                <button
                  type="button"
                  disabled={undoing}
                  onClick={handleUndo}
                  className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-current/30 text-base font-semibold transition-opacity active:opacity-70 disabled:opacity-50"
                >
                  <Undo2 className="h-5 w-5" aria-hidden="true" />
                  {undoing ? "Undoing…" : verdict.kind === "success" && undoLeftMs != null ? `Undo · ${formatDuration(undoLeftMs)}` : "Undo"}
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  "min-h-14 shrink-0 rounded-2xl border-2 text-base font-semibold",
                  "border-current/25 transition-opacity active:opacity-70",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current",
                  canUndo ? "flex-[2]" : "w-full"
                )}
              >
                Scan next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanResultComponent;
