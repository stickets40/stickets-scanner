"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { liveStatsSchema } from "@/types/verdict.types";
import { useSessionStore } from "@/stores/session.store";

const POLL_MS = 15_000;

/** Venue-wide "412 / 1,200 in" for the header. Paused while hidden, offline or signed out. */
export function useLiveStats(enabled: boolean): void {
  const auth = useSessionStore((s) => s.auth);
  const connectivity = useSessionStore((s) => s.connectivity);
  const setVenue = useSessionStore((s) => s.setVenue);

  useEffect(() => {
    if (!enabled || auth === "reauth_required" || connectivity !== "online") {
      // Keep the last figure but flag it as old.
      const current = useSessionStore.getState().venue;
      if (current) setVenue(current, true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const r = await api.get("stats/live", { timeoutMs: 5000 });
        if (cancelled) return;
        const parsed = r.ok ? liveStatsSchema.safeParse(r.data) : null;
        if (parsed?.success) {
          setVenue({ admitted: parsed.data.admitted, total: parsed.data.totalTickets, asOf: parsed.data.serverTime }, false);
        } else {
          const current = useSessionStore.getState().venue;
          if (current) setVenue(current, true);
        }
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, auth, connectivity, setVenue]);
}
