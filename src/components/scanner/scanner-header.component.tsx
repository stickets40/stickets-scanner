"use client";

import { CloudOff, Database, KeyRound, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import { useSessionStore } from "@/stores/session.store";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useQueueStatus } from "@/hooks/use-queue-status";
import { manifestAgeLabel } from "@/lib/manifest";
import { formatDuration, formatTime, now as clockNow } from "@/lib/clock";
import { cn } from "@/lib/cn";

interface ScannerHeaderProps {
  onOpenQueue: () => void;
  onOpenReauth: () => void;
}

type ChipTone = "alert" | "warn" | "neutral" | "syncing";

interface Chip {
  key: string;
  tone: ChipTone;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}

/**
 * Information only. Answers "where am I, what am I carrying, can I trust the
 * network and the offline data?" — at most three chips, by priority, plus the
 * venue-wide count from the server when it is fresh.
 */
const ScannerHeaderComponent = ({ onOpenQueue, onOpenReauth }: ScannerHeaderProps) => {
  const scanner = useAuthStore((s) => s.scanner);
  const connectivity = useConnectivity();
  const queue = useQueueStatus();
  const auth = useSessionStore((s) => s.auth);
  const expiresAt = useSessionStore((s) => s.expiresAt);
  const renewalFailed = useSessionStore((s) => s.renewalFailed);
  const manifest = useSessionStore((s) => s.manifest);
  const idbUnavailable = useSessionStore((s) => s.idbUnavailable);
  const venue = useSessionStore((s) => s.venue);
  const venueStale = useSessionStore((s) => s.venueStale);

  const chips: Chip[] = [];
  if (queue.needsReview > 0) {
    chips.push({ key: "review", tone: "alert", icon: <TriangleAlert className="h-4 w-4" aria-hidden="true" />, label: `${queue.needsReview} to review`, onClick: onOpenQueue });
  }
  if (auth === "reauth_required") {
    chips.push({ key: "reauth", tone: "alert", icon: <KeyRound className="h-4 w-4" aria-hidden="true" />, label: "Sign in again", onClick: onOpenReauth });
  }
  if (connectivity.status === "offline") {
    chips.push({ key: "net", tone: "neutral", icon: <WifiOff className="h-4 w-4" aria-hidden="true" />, label: "Offline" });
  } else if (connectivity.status === "degraded") {
    chips.push({ key: "net", tone: "warn", icon: <WifiOff className="h-4 w-4" aria-hidden="true" />, label: "Reconnecting…" });
  }
  if (queue.unverified > 0) {
    const syncing = connectivity.status === "online" && auth !== "reauth_required";
    chips.push({
      key: "queue",
      tone: syncing ? "syncing" : "neutral",
      icon: <CloudOff className="h-4 w-4" aria-hidden="true" />,
      label: syncing ? `Syncing ${queue.unverified}` : `${queue.unverified} queued`,
      onClick: onOpenQueue,
    });
  }
  if (queue.stalled + queue.failed > 0) {
    chips.push({ key: "stalled", tone: "warn", icon: <TriangleAlert className="h-4 w-4" aria-hidden="true" />, label: `${queue.stalled + queue.failed} stuck`, onClick: onOpenQueue });
  }
  if (idbUnavailable) {
    chips.push({ key: "idb", tone: "warn", icon: <Database className="h-4 w-4" aria-hidden="true" />, label: "Live only" });
  } else if (manifest) {
    const ageMs = clockNow() - Date.parse(manifest.lastDeltaAt ?? manifest.syncedAt);
    const label = manifestAgeLabel(ageMs);
    if (label !== "ok" && connectivity.status !== "online") {
      chips.push({ key: "manifest", tone: label === "stale" ? "warn" : "neutral", icon: <Database className="h-4 w-4" aria-hidden="true" />, label: `Offline data ${formatDuration(ageMs)} old` });
    }
  }
  if (renewalFailed && expiresAt) {
    const left = Date.parse(expiresAt) - clockNow();
    if (left > 0 && left < 60 * 60 * 1000) {
      chips.push({ key: "session", tone: "warn", icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />, label: `Session ends in ${formatDuration(left)}`, onClick: onOpenReauth });
    }
  }

  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-4 pb-8"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-white">{scanner?.name ?? "Scanner"}</h1>
          <p className="truncate text-xs font-medium text-white/85">{scanner?.eventName ?? `Event #${scanner?.eventId ?? "—"}`}</p>
          {venue && (
            <p className="mt-0.5 text-xs font-medium tabular text-white/85">
              {venue.admitted.toLocaleString()} / {venue.total.toLocaleString()} in
              {venueStale && <span className="text-white/60"> · as of {formatTime(venue.asOf)}</span>}
            </p>
          )}
        </div>
        <div className="pointer-events-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {chips.slice(0, 3).map(({ key, ...chip }) => (
            <ChipButton key={key} {...chip} />
          ))}
        </div>
      </div>
    </header>
  );
};

function ChipButton({ onClick, tone, icon, label }: Omit<Chip, "key">) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
        "backdrop-blur-sm transition-opacity active:opacity-70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        tone === "alert" && "bg-invalid text-invalid-ink",
        tone === "warn" && "bg-used text-used-ink",
        tone === "neutral" && "bg-white/20 text-white",
        tone === "syncing" && "animate-pulse-soft bg-white/20 text-white"
      )}
    >
      {icon}
      <span>{label}</span>
    </Tag>
  );
}

export default ScannerHeaderComponent;
