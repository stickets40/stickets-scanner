"use client";

import { Hand, Vibrate, VibrateOff, Volume2, VolumeX, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth.store";
import type { ScanMode } from "@/types/scanner.types";

const MODES: { value: ScanMode; label: string; description: string; icon: typeof Zap }[] = [
  {
    value: "fast",
    label: "Fast",
    description: "Valid tickets clear themselves after a moment. Anything that needs a decision still waits for you.",
    icon: Zap,
  },
  {
    value: "confirm",
    label: "Confirm",
    description: "Every result waits until you tap. Slower, but nothing passes unseen.",
    icon: Hand,
  },
];

/** Throughput, sound and vibration are three independent axes. */
const ScanModeToggleComponent = () => {
  const scanMode = useAuthStore((s) => s.scanMode);
  const setScanMode = useAuthStore((s) => s.setScanMode);
  const soundEnabled = useAuthStore((s) => s.soundEnabled);
  const setSoundEnabled = useAuthStore((s) => s.setSoundEnabled);
  const vibrationEnabled = useAuthStore((s) => s.vibrationEnabled);
  const setVibrationEnabled = useAuthStore((s) => s.setVibrationEnabled);
  const hasVibration = typeof navigator !== "undefined" && "vibrate" in navigator;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-ink">Scan speed</h2>
        <p className="mb-3 text-xs text-ink-muted">Also switchable from the scanner without opening settings.</p>
        <div role="radiogroup" aria-label="Scan speed" className="space-y-2">
          {MODES.map((mode) => {
            const selected = scanMode === mode.value;
            const Icon = mode.icon;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setScanMode(mode.value)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
                  selected ? "border-brand bg-brand/10" : "border-line bg-surface-2 active:bg-line-soft"
                )}
              >
                <span
                  className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-brand" : "border-ink-faint")}
                  aria-hidden="true"
                >
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {mode.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{mode.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Switch
        title="Sound"
        checked={soundEnabled}
        onChange={setSoundEnabled}
        label={soundEnabled ? "Tones on" : "Tones off"}
        description="Each result has its own tone contour, recognisable through a PA."
        icon={soundEnabled ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
      />
      <Switch
        title="Vibration"
        checked={vibrationEnabled}
        onChange={setVibrationEnabled}
        label={vibrationEnabled ? "Haptics on" : "Haptics off"}
        description={hasVibration ? "A distinct pattern per result." : "Not supported by this browser (iPhone Safari has no vibration API)."}
        icon={vibrationEnabled ? <Vibrate className="h-4 w-4" aria-hidden="true" /> : <VibrateOff className="h-4 w-4" aria-hidden="true" />}
        disabled={!hasVibration}
      />
    </div>
  );
};

function Switch({
  title,
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
}: {
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
          "border-line bg-surface-2 active:bg-line-soft disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        )}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {icon}
            {label}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
        </span>
        <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-line")} aria-hidden="true">
          <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
        </span>
      </button>
    </div>
  );
}

export default ScanModeToggleComponent;
