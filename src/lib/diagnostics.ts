import { getDeviceId } from "@/lib/device-id";
import { getSkewMs } from "@/lib/clock";
import { getManifestMeta, manifestCounts } from "@/lib/manifest";
import { queueCounts } from "@/lib/scan-queue";
import { probeIdb, storageEstimate } from "@/lib/idb";
import { recentTelemetry } from "@/lib/telemetry";
import { useSessionStore } from "@/stores/session.store";
import { useAuthStore } from "@/stores/auth.store";

/**
 * "Export diagnostics" — the first thing to ask for on any door report. One
 * JSON blob with everything that explains a device's behaviour and nothing
 * that identifies a ticket holder (names and payloads are left out).
 */
export async function buildDiagnostics(): Promise<Record<string, unknown>> {
  const session = useSessionStore.getState();
  const auth = useAuthStore.getState();
  const [idb, storage, manifest, counts, queue] = await Promise.all([
    probeIdb(),
    storageEstimate(),
    getManifestMeta().catch(() => null),
    manifestCounts().catch(() => null),
    queueCounts().catch(() => null),
  ]);
  let sw: string = "unsupported";
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      sw = reg ? (reg.active ? "active" : reg.installing ? "installing" : reg.waiting ? "waiting" : "registered") : "none";
      if (reg?.waiting) sw += "+waiting";
    }
  } catch {
    sw = "error";
  }
  return {
    exportedAt: new Date().toISOString(),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    deviceId: getDeviceId(),
    userAgent: navigator.userAgent,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    secureContext: window.isSecureContext,
    browserOnline: navigator.onLine,
    connectivity: session.connectivity,
    rateLimitedUntil: session.rateLimitedUntil ? new Date(session.rateLimitedUntil).toISOString() : null,
    auth: { state: session.auth, code: session.authErrorCode, expiresAt: session.expiresAt, renewalFailed: session.renewalFailed },
    scanner: auth.scanner ? { id: auth.scanner.scannerId, name: auth.scanner.name, eventId: auth.scanner.eventId, allowedTicketTypeIds: auth.scanner.allowedTicketTypeIds } : null,
    prefs: { scanMode: auth.scanMode, sound: auth.soundEnabled, vibration: auth.vibrationEnabled, camera: auth.preferredCameraId },
    clockSkewMs: getSkewMs(),
    idb,
    storage,
    serviceWorker: sw,
    updateAvailable: session.updateAvailable,
    manifest: manifest
      ? { eventId: manifest.eventId, gen: manifest.gen, count: manifest.count, lastFullAt: manifest.lastFullAt, syncedAt: manifest.syncedAt, lastDeltaAt: manifest.lastDeltaAt, window: manifest.window, counts }
      : null,
    manifestSync: { state: session.manifestSync, error: session.manifestError },
    queue,
    recentTelemetry: recentTelemetry(),
  };
}

export async function copyDiagnostics(): Promise<string> {
  const text = JSON.stringify(await buildDiagnostics(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard may be unavailable — the caller can show the text */
  }
  return text;
}
