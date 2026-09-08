"use client";

import { useEffect } from "react";
import Link from "next/link";
import Button from "@/components/ui/button";
import { beacon } from "@/lib/telemetry";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

function isChunkLoadError(error: Error): boolean {
  return error.name === "ChunkLoadError" || /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message);
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    beacon("client_error", { name: error.name, message: error.message.slice(0, 300), digest: error.digest });
    // A stale shell asking for chunks a newer deploy removed: one automatic
    // reload per build fixes it; a second failure falls through to the UI.
    if (isChunkLoadError(error)) {
      const key = `stickets:reloaded:${BUILD_ID}`;
      try {
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
        }
      } catch {
        /* sessionStorage blocked — show the UI */
      }
    }
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-0 px-8 text-center" role="alert">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="max-w-[40ch] text-sm leading-relaxed text-ink-muted">
        The scanner hit an unexpected error. Your session is still active and any queued scans are safe on this device.
      </p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <Button onClick={reset} className="w-full">
          Try again
        </Button>
        <Button variant="secondary" onClick={() => window.location.reload()} className="w-full">
          Reload app
        </Button>
        <Link
          href="/scan"
          className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-line bg-surface-2 px-6 font-semibold text-ink transition-colors active:bg-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
        >
          Back to scanner
        </Link>
      </div>
    </div>
  );
}
