"use client";

import { useEffect } from "react";
import { drainQueue, purgeSynced } from "@/lib/scan-queue";

/**
 * Registers the service worker (offline app-shell) and drains the offline scan
 * queue whenever connectivity returns. Mounted once at the app root.
 */
export function PwaProvider() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW registration is best-effort; the app still works online */
      });
    }
  }, []);

  useEffect(() => {
    // Background drain: POST straight to the BFF (bypassing the ky 401-redirect
    // hook so a background sync never yanks the operator to /login).
    const poster = async (body: { payload: string; scanId: string }) => {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    };

    let running = false;
    const drain = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        await drainQueue(poster);
        await purgeSynced();
      } catch {
        /* try again on the next online event */
      } finally {
        running = false;
      }
    };

    drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
  }, []);

  return null;
}
