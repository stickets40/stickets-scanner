"use client";

import { useCallback, useEffect } from "react";
import { queueCounts, type QueueCounts } from "@/lib/scan-queue";
import { QUEUE_CHANGED_EVENT } from "@/lib/events";
import { useSessionStore } from "@/stores/session.store";

/**
 * Queue depth for the scanner chrome. Depth, not link state, is what tells an
 * operator how much unverified risk they are carrying.
 */
export function useQueueStatus(): QueueCounts & { refresh: () => void } {
  const counts = useSessionStore((s) => s.queue);
  const setQueue = useSessionStore((s) => s.setQueue);

  const refresh = useCallback(() => {
    void queueCounts()
      .then(setQueue)
      .catch(() => {});
  }, [setQueue]);

  useEffect(() => {
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, [refresh]);

  return { ...counts, refresh };
}
