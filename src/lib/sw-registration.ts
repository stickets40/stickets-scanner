import { useSessionStore } from "@/stores/session.store";

/**
 * Service-worker lifecycle. The worker is registered with the build id in its
 * URL so every deploy is a new worker; it never skipWaiting()s on its own — a
 * mid-shift reload under an operator's thumb is the one thing we must not do.
 * `updateAvailable` shows a toast; the operator applies it between holders.
 */
const UPDATE_CHECK_MIN_GAP_MS = 30 * 60 * 1000;
let registration: ServiceWorkerRegistration | null = null;
let lastUpdateCheck = 0;
let reloading = false;

export async function registerSw(buildId: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    useSessionStore.getState().setSwState("unsupported");
    return;
  }
  const store = useSessionStore.getState();
  store.setSwState("registering");
  try {
    registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(buildId)}`);
    store.setSwState("active");
    if (registration.waiting) store.setUpdateAvailable(true);
    registration.addEventListener("updatefound", () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          useSessionStore.getState().setUpdateAvailable(true);
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  } catch {
    store.setSwState("failed");
  }
}

/** Operator-triggered: activate the waiting worker and reload. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  reloading = false;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

export async function checkForUpdate(force = false): Promise<void> {
  if (!registration) return;
  const now = Date.now();
  if (!force && now - lastUpdateCheck < UPDATE_CHECK_MIN_GAP_MS) return;
  lastUpdateCheck = now;
  try {
    await registration.update();
  } catch {
    /* offline or blocked — try again later */
  }
}

/** After login and on every /scan mount: make sure the shell is servable offline. */
export function precacheShell(): void {
  const worker = registration?.active ?? navigator.serviceWorker?.controller;
  worker?.postMessage({ type: "PRECACHE_SHELL" });
}
