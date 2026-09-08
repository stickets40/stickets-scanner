"use client";

import { CameraOff } from "lucide-react";
import Link from "next/link";
import type { CameraErrorInfo } from "@/lib/camera-error";

interface Props {
  info: CameraErrorInfo;
  attempt: number;
  onRetry: () => void;
}

/**
 * Inline camera failure. The header and controls keep rendering around it, so
 * the operator can still open the shift log, switch camera in settings or use
 * the name lookup — a dead camera must never take the whole gate with it.
 */
const CameraErrorPanelComponent = ({ info, attempt, onRetry }: Props) => (
  <div
    className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 bg-surface-0 px-8 text-center"
    role="alert"
    style={{ paddingTop: "calc(env(safe-area-inset-top) + 5rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
  >
    <CameraOff className="h-12 w-12 text-ink-faint" aria-hidden="true" />
    <h2 className="text-lg font-semibold text-ink">{info.title}</h2>
    <p className="max-w-[42ch] text-sm leading-relaxed text-ink-muted">{info.body}</p>
    {attempt > 0 && <p className="text-xs text-ink-faint">Tried {attempt} time{attempt === 1 ? "" : "s"} automatically.</p>}
    <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
      {info.canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-12 rounded-2xl bg-brand px-8 font-semibold text-white transition-colors active:bg-brand/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        >
          Retry camera
        </button>
      )}
      <Link
        href="/settings#camera"
        className="flex min-h-12 items-center justify-center rounded-2xl border border-line bg-surface-2 px-6 font-semibold text-ink transition-colors active:bg-line-soft"
      >
        Choose a different camera
      </Link>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-12 rounded-2xl border border-line bg-surface-2 px-6 font-semibold text-ink transition-colors active:bg-line-soft"
      >
        Reload app
      </button>
      <p className="mt-1 text-xs text-ink-muted">Meanwhile, use Lookup below to check people in by name.</p>
    </div>
  </div>
);

export default CameraErrorPanelComponent;
