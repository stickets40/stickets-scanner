"use client";

import Link from "next/link";
import { Hand, ListChecks, Search, Settings, Volume2, VolumeX, Zap } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import { cn } from "@/lib/cn";

interface ScannerControlsProps {
  onOpenShift: () => void;
  onOpenLookup: () => void;
  admittedCount: number;
}

/**
 * Bottom action bar — everything interactive, inside the thumb arc. Lookup
 * (name / email search + manual check-in) sits here because it is the fallback
 * for a torn ticket, a dead phone screen or a dead camera.
 */
const ScannerControlsComponent = ({ onOpenShift, onOpenLookup, admittedCount }: ScannerControlsProps) => {
  const scanMode = useAuthStore((s) => s.scanMode);
  const setScanMode = useAuthStore((s) => s.setScanMode);
  const soundEnabled = useAuthStore((s) => s.soundEnabled);
  const setSoundEnabled = useAuthStore((s) => s.setSoundEnabled);
  const isFast = scanMode === "fast";

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-4 pt-10"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenShift}
          className={cn(
            "flex min-h-12 items-center gap-2 rounded-2xl bg-white/15 px-4",
            "text-white backdrop-blur-sm transition-colors active:bg-white/25",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          )}
        >
          <ListChecks className="h-5 w-5" aria-hidden="true" />
          <span className="tabular text-base font-semibold">{admittedCount}</span>
          <span className="sr-only">admitted this shift. Open shift log</span>
          <span aria-hidden="true" className="text-xs font-medium opacity-75">
            in
          </span>
        </button>

        <div className="flex items-center gap-2">
          <IconButton onClick={onOpenLookup} label="Look up a ticket by name">
            <Search className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          <IconButton onClick={() => setSoundEnabled(!soundEnabled)} label={soundEnabled ? "Mute scan sounds" : "Unmute scan sounds"} active={!soundEnabled}>
            {soundEnabled ? <Volume2 className="h-5 w-5" aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
          </IconButton>
          <button
            type="button"
            onClick={() => setScanMode(isFast ? "confirm" : "fast")}
            aria-pressed={isFast}
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-2xl px-3 backdrop-blur-sm",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              isFast ? "bg-brand text-white active:bg-brand/80" : "bg-white/15 text-white active:bg-white/25"
            )}
          >
            {isFast ? <Zap className="h-5 w-5" aria-hidden="true" /> : <Hand className="h-5 w-5" aria-hidden="true" />}
            <span className="text-sm font-semibold">{isFast ? "Fast" : "Confirm"}</span>
          </button>
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15",
              "text-white backdrop-blur-sm transition-colors active:bg-white/25",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            )}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
};

function IconButton({ active, onClick, label, children }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-2xl backdrop-blur-sm",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        active ? "bg-white/30 text-white active:bg-white/40" : "bg-white/15 text-white active:bg-white/25"
      )}
    >
      {children}
    </button>
  );
}

export default ScannerControlsComponent;
