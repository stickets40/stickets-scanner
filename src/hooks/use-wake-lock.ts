"use client";

import { useEffect } from "react";

/**
 * Hold the screen awake while the scanner is mounted.
 *
 * A gap in the queue and thirty seconds later the phone has locked. The
 * operator then unlocks, waits for the PWA to resume, and waits again for the
 * camera to re-initialise — all with someone standing in front of them. A live
 * <video> element suppresses idle sleep on Android Chrome, so this mostly
 * matters on iOS, which is also where the app has no haptics to fall back on.
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        /* denied or unsupported — the app still works, the screen just sleeps */
      }
    };

    // iOS drops the sentinel whenever the app is backgrounded, so re-acquire
    // on every return to visible rather than assuming the first grant holds.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
