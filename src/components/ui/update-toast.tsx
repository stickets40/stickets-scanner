"use client";

import { RefreshCw } from "lucide-react";
import { useSessionStore } from "@/stores/session.store";
import { applyUpdate } from "@/lib/sw-registration";

/** A new deploy is waiting. Never applied automatically — the operator picks the moment. */
export default function UpdateToast() {
  const updateAvailable = useSessionStore((s) => s.updateAvailable);
  if (!updateAvailable) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-20 flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface-1 px-4 py-3 shadow-lg" role="status">
        <RefreshCw className="h-4 w-4 text-brand-ink" aria-hidden="true" />
        <span className="text-sm text-ink">Update available</span>
        <button type="button" onClick={applyUpdate} className="min-h-10 rounded-xl bg-brand px-3 text-sm font-semibold text-white active:bg-brand/80">
          Reload
        </button>
      </div>
    </div>
  );
}
