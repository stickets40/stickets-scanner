"use client";

import { useEffect } from "react";
import { initDeviceId } from "@/lib/device-id";
import { probeIdb } from "@/lib/idb";
import { loadClock } from "@/lib/clock";
import { browserOnline, getConnectivityMonitor, isEffectivelyOnline } from "@/lib/connectivity";
import { registerSw, checkForUpdate } from "@/lib/sw-registration";
import { createSyncScheduler } from "@/lib/sync-scheduler";
import { pendingCount } from "@/lib/scan-queue";
import { drainNow, loadManifestSummary, syncManifestNow } from "@/lib/runtime";
import { AUTH_RESTORED_EVENT } from "@/lib/events";
import { beacon } from "@/lib/telemetry";
import { useAuthStore } from "@/stores/auth.store";
import { useSessionStore } from "@/stores/session.store";
import Banners from "./banners";
import UpdateToast from "./update-toast";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const MANIFEST_DELTA_MS = 60_000;

/**
 * Boot sequence, mounted once at the app root:
 *   device id → storage probe → clock → connectivity → service worker →
 *   queue scheduler → manifest loop → session listeners.
 * Renders the global overlays (banners, update toast).
 */
export function AppProviders() {
  useEffect(() => {
    const session = useSessionStore.getState();
    const monitor = getConnectivityMonitor();
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    let scheduler: ReturnType<typeof createSyncScheduler> | null = null;
    let manifestTimer: ReturnType<typeof setInterval> | null = null;

    const canDrain = () =>
      browserOnline() && isEffectivelyOnline(monitor.getState()) && useSessionStore.getState().auth !== "reauth_required";

    const onAuthRestored = () => void syncManifestNow("auto");
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
        if (canDrain()) void syncManifestNow("delta");
      }
    };

    (async () => {
      const deviceId = await initDeviceId();
      session.setDeviceId(deviceId);

      const idb = await probeIdb();
      session.setIdbUnavailable(idb === "unavailable");
      if (idb === "unavailable") beacon("idb_unavailable");

      await loadClock();

      monitor.start();
      unsubscribe = monitor.subscribe((s) => useSessionStore.getState().setConnectivity(s.status, s.rateLimitedUntil));
      useSessionStore.getState().setConnectivity(monitor.getState().status, monitor.getState().rateLimitedUntil);

      void registerSw(BUILD_ID);
      if (stopped) return;

      await loadManifestSummary();

      scheduler = createSyncScheduler({ drain: drainNow, canDrain, pendingCount });
      scheduler.start();

      if (useAuthStore.getState().scanner) void syncManifestNow("auto");
      manifestTimer = setInterval(() => {
        if (document.visibilityState === "visible" && canDrain() && useAuthStore.getState().scanner) void syncManifestNow("delta");
      }, MANIFEST_DELTA_MS);

      window.addEventListener(AUTH_RESTORED_EVENT, onAuthRestored);
      document.addEventListener("visibilitychange", onVisible);
    })().catch((error) => {
      beacon("boot_failed", { message: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      stopped = true;
      unsubscribe?.();
      monitor.stop();
      scheduler?.stop();
      if (manifestTimer) clearInterval(manifestTimer);
      window.removeEventListener(AUTH_RESTORED_EVENT, onAuthRestored);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <>
      <Banners />
      <UpdateToast />
    </>
  );
}

export default AppProviders;
