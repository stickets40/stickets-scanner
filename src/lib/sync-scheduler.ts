import { AUTH_RESTORED_EVENT, QUEUE_DRAIN_EVENT } from "@/lib/events";
import type { DrainResult } from "@/lib/scan-queue";

export interface SyncSchedulerDeps {
  drain: () => Promise<DrainResult>;
  /** Only a confirmed-good, not rate-limited network gets a drain. */
  canDrain: () => boolean;
  pendingCount: () => Promise<number>;
  intervalMs?: number;
}

/**
 * When to drain: boot, the link coming back, the tab becoming visible, an
 * explicit request (login, re-auth), and every 15 s while anything is
 * pending. Never overlapping; never while the session needs re-auth or the
 * network is degraded / rate limited (the connectivity monitor owns that).
 */
export function createSyncScheduler(deps: SyncSchedulerDeps) {
  const intervalMs = deps.intervalMs ?? 15_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let queued = false;

  const run = async () => {
    if (running) {
      queued = true;
      return;
    }
    if (!deps.canDrain()) return;
    running = true;
    try {
      let result = await deps.drain();
      // Keep going while full batches keep succeeding.
      let guard = 0;
      while (result.processed > 0 && result.stoppedBy === null && deps.canDrain() && guard++ < 200) {
        result = await deps.drain();
      }
    } catch {
      /* the next trigger retries */
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  };

  const tick = async () => {
    const pending = await deps.pendingCount().catch(() => 0);
    if (pending > 0) void run();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void run();
  };
  const onTrigger = () => void run();

  return {
    start() {
      if (typeof window === "undefined") return;
      window.addEventListener("online", onTrigger);
      window.addEventListener(QUEUE_DRAIN_EVENT, onTrigger);
      window.addEventListener(AUTH_RESTORED_EVENT, onTrigger);
      document.addEventListener("visibilitychange", onVisible);
      timer = setInterval(() => void tick(), intervalMs);
      void run();
    },
    stop() {
      if (typeof window === "undefined") return;
      window.removeEventListener("online", onTrigger);
      window.removeEventListener(QUEUE_DRAIN_EVENT, onTrigger);
      window.removeEventListener(AUTH_RESTORED_EVENT, onTrigger);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
      timer = null;
    },
    requestDrain: () => void run(),
  };
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>;
