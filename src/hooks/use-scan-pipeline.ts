"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { now as clockNow, nowIso } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { clearLocalUsed } from "@/lib/manifest";
import { revertOfflineAdmission } from "@/lib/scan-queue";
import { commitUnverified, runScan, serverToVerdict } from "@/lib/scan-engine";
import { createScanContext } from "@/lib/runtime";
import { appendShiftEntry, markEntryUndone } from "@/lib/shift-log";
import { signal } from "@/lib/feedback";
import { beacon } from "@/lib/telemetry";
import { useAuthStore } from "@/stores/auth.store";
import { CHOICE_KINDS, undoResultSchema, type ServerVerdict, type Verdict } from "@/types/verdict.types";
import { FAST_MODE_DWELL_MS } from "@/types/scanner.types";

export interface ScanPipeline {
  verdict: Verdict | null;
  busy: boolean;
  handleDetected: (raw: string) => Promise<void>;
  dismiss: () => void;
  choose: (decision: "admit" | "deny") => Promise<void>;
  tryOnline: () => Promise<void>;
  undo: () => Promise<string | null>;
  presentServerVerdict: (scanId: string, verdict: ServerVerdict) => void;
}

function shiftEntryFor(v: Verdict): Parameters<typeof appendShiftEntry>[0] | null {
  const base = { at: nowIso(), kind: v.kind, scanId: v.scanId };
  switch (v.kind) {
    case "success":
      return { ...base, ownerName: v.ticket.ownerName, ticketTypeName: v.ticket.ticketTypeName, scanLogId: v.server.scanLogId, undoableUntil: v.server.undoableUntil, detail: v.server.replayed ? "already recorded" : undefined };
    case "success_offline":
      return { ...base, ownerName: v.ticket.ownerName, ticketTypeName: v.ticket.ticketTypeName, offline: true };
    case "already_used":
      return { ...base, ownerName: v.ticket.ownerName, ticketTypeName: v.ticket.ticketTypeName || undefined, detail: v.server.sameDevice ? "double scan" : v.server.firstScannedBy ? `by ${v.server.firstScannedBy.scannerName}` : undefined };
    case "already_used_offline":
      return { ...base, ownerName: v.ticket.ownerName, ticketTypeName: v.ticket.ticketTypeName, offline: true, detail: v.sameDevice ? "double scan" : "offline data" };
    case "wrong_scanner":
      return { ...base, ownerName: v.ticket?.ownerName, ticketTypeName: v.ticket?.ticketTypeName, detail: v.correctScannerNames.length ? `send to ${v.correctScannerNames.join(", ")}` : (v.message ?? undefined), offline: v.source === "offline" };
    case "outside_window":
      return { ...base, ownerName: v.ticket?.ownerName, ticketTypeName: v.ticket?.ticketTypeName, detail: v.reason === "too_early" ? "too early" : "scanning ended", offline: v.source === "offline" };
    case "invalid":
      return { ...base, detail: v.message, offline: v.source === "offline" };
    case "admitted_unverified":
      return { ...base, offline: true, detail: "admitted without verification" };
    case "unverifiable_denied":
      return { ...base, detail: "could not verify — turned away" };
    case "error":
      return { ...base, detail: v.message };
    case "undone":
      return null; // markEntryUndone handles the original row
    case "authentic_not_in_manifest":
    case "unverifiable":
      return null; // logged once the operator decides
  }
}

/**
 * The scan pipeline: detection → engine → verdict → feedback → shift log,
 * with the busy/verdict guards that keep a second detection from racing the
 * first (hashing is sync now, so there is no await between "code seen" and
 * "code claimed").
 */
export function useScanPipeline(): ScanPipeline {
  const scanMode = useAuthStore((s) => s.scanMode);
  const soundEnabled = useAuthStore((s) => s.soundEnabled);
  const vibrationEnabled = useAuthStore((s) => s.vibrationEnabled);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const verdictRef = useRef<Verdict | null>(null);
  const lastHandledRef = useRef<{ hash: string; at: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefs = useRef({ scanMode, soundEnabled, vibrationEnabled });
  prefs.current = { scanMode, soundEnabled, vibrationEnabled };

  const clear = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    verdictRef.current = null;
    setVerdict(null);
    if (lastHandledRef.current) lastHandledRef.current = { ...lastHandledRef.current, at: clockNow() };
  }, []);

  const present = useCallback(
    (v: Verdict) => {
      verdictRef.current = v;
      setVerdict(v);
      signal(v.kind, { silent: !prefs.current.soundEnabled, noVibration: !prefs.current.vibrationEnabled });
      const entry = shiftEntryFor(v);
      if (entry) void appendShiftEntry(entry).catch(() => {});
      if (v.kind === "undone" || v.kind === "success" || v.kind === "success_offline") {
        // nothing extra
      }
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      if (prefs.current.scanMode === "fast" && (v.kind === "success" || v.kind === "success_offline")) {
        dismissTimer.current = setTimeout(clear, FAST_MODE_DWELL_MS);
      }
    },
    [clear]
  );

  const handleDetected = useCallback(
    async (raw: string) => {
      if (busyRef.current || verdictRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const outcome = await runScan(createScanContext({ recent: () => lastHandledRef.current }), raw);
        if (outcome.kind === "ignored") return;
        lastHandledRef.current = { hash: sha256Hex(raw), at: clockNow() };
        present(outcome);
      } catch (error) {
        beacon("scan_pipeline_error", { message: error instanceof Error ? error.message : String(error) });
        present({ kind: "error", scanId: crypto.randomUUID(), message: "The scanner hit a problem. Scan again." });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [present]
  );

  const choose = useCallback(
    async (decision: "admit" | "deny") => {
      const v = verdictRef.current;
      if (!v || !CHOICE_KINDS.has(v.kind)) return;
      const result = await commitUnverified(createScanContext({ recent: () => null }), v as Extract<Verdict, { kind: "unverifiable" | "authentic_not_in_manifest" }>, decision);
      present(result);
    },
    [present]
  );

  const tryOnline = useCallback(async () => {
    const v = verdictRef.current;
    if (!v || !CHOICE_KINDS.has(v.kind)) return;
    const choice = v as Extract<Verdict, { kind: "unverifiable" | "authentic_not_in_manifest" }>;
    busyRef.current = true;
    setBusy(true);
    try {
      const outcome = await runScan(createScanContext({ recent: () => null, forceOnline: true }), choice.payload, choice.scanId);
      if (outcome.kind !== "ignored") present(outcome);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [present]);

  /** Undo the admission on screen. Returns an error message, or null on success. */
  const undo = useCallback(async (): Promise<string | null> => {
    const v = verdictRef.current;
    if (!v) return null;
    if (v.kind === "success") {
      const r = await api.post("scan/undo", { scanLogId: v.server.scanLogId });
      if (!r.ok) {
        const code = r.code ?? "";
        if (code === "UNDO_WINDOW_EXPIRED") return "The undo window has closed.";
        if (code === "UNDO_NOT_OWNER") return "Only the device that admitted them can undo.";
        if (code === "UNDO_STATE_CHANGED") return "This ticket changed since — nothing to undo.";
        if (r.status === 404) return "Admission not found.";
        return r.message ?? "Could not undo.";
      }
      const parsed = undoResultSchema.safeParse(r.data);
      await markEntryUndone(v.scanId).catch(() => {});
      present({ kind: "undone", scanId: v.scanId, tokenId: parsed.success ? parsed.data.tokenId : v.ticket.tokenId ?? "" });
      return null;
    }
    if (v.kind === "success_offline" || v.kind === "admitted_unverified") {
      const removed = await revertOfflineAdmission(v.scanId);
      if (!removed) return "This admission already reached the server — undo it from the shift log.";
      if (removed.ticketHint?.h) await clearLocalUsed(removed.ticketHint.h).catch(() => {});
      await markEntryUndone(v.scanId).catch(() => {});
      present({ kind: "undone", scanId: v.scanId, tokenId: removed.ticketHint?.tokenId ?? "" });
      return null;
    }
    return "Nothing to undo.";
  }, [present]);

  const presentServerVerdict = useCallback(
    (scanId: string, server: ServerVerdict) => {
      if (busyRef.current) return;
      present(serverToVerdict(scanId, server));
    },
    [present]
  );

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  // Dev-only hook so the pipeline can be exercised without a camera
  // (e.g. from the browser console or an automated check).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __stickets?: { scan?: (raw: string) => Promise<void> } };
    w.__stickets = { ...(w.__stickets ?? {}), scan: handleDetected };
    return () => {
      if (w.__stickets) delete w.__stickets.scan;
    };
  }, [handleDetected]);

  return { verdict, busy, handleDetected, dismiss: clear, choose, tryOnline, undo, presentServerVerdict };
}
