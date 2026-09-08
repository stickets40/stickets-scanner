"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CloudOff, Copy, Database, KeyRound, LogOut, RefreshCw, Stethoscope } from "lucide-react";
import { useDevices } from "@yudiel/react-qr-scanner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { useSessionStore } from "@/stores/session.store";
import { useQueueStatus } from "@/hooks/use-queue-status";
import { retryStalled } from "@/lib/scan-queue";
import { clearManifest } from "@/lib/manifest";
import { syncManifestNow } from "@/lib/runtime";
import { requestQueueDrain } from "@/lib/events";
import { copyDiagnostics } from "@/lib/diagnostics";
import { formatDuration, formatTime, now as clockNow } from "@/lib/clock";
import Button from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import ScanModeToggleComponent from "./scan-mode-toggle.component";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

const SettingsPanelComponent = () => {
  const router = useRouter();
  const scanner = useAuthStore((s) => s.scanner);
  const accessMethod = useAuthStore((s) => s.accessMethod);
  const logout = useAuthStore((s) => s.logout);
  const preferredCameraId = useAuthStore((s) => s.preferredCameraId);
  const setPreferredCameraId = useAuthStore((s) => s.setPreferredCameraId);
  const session = useSessionStore();
  const queue = useQueueStatus();
  const devices = useDevices();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewMsg, setRenewMsg] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => clockNow());

  useEffect(() => {
    const t = setInterval(() => setNowMs(clockNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  const unresolved = queue.unverified + queue.needsReview;

  const doLogout = async () => {
    setIsSigningOut(true);
    try {
      await api.post("auth/logout", {}, { untracked: true });
    } catch {
      /* best-effort — still clear locally */
    }
    // Offline data holds attendee names: wipe it when nothing is left to sync.
    if (queue.unverified === 0) await clearManifest().catch(() => {});
    logout();
    useSessionStore.getState().setAuth("unknown");
    useSessionStore.getState().setManifest(null);
    router.push("/login");
  };

  const handleSignOutClick = () => {
    if (unresolved > 0 && !confirming) {
      setConfirming(true);
      requestQueueDrain();
      return;
    }
    void doLogout();
  };

  const renewNow = async () => {
    setRenewing(true);
    setRenewMsg(null);
    const r = await api.post("auth/refresh", {}, { timeoutMs: 8000 });
    setRenewing(false);
    if (r.ok) {
      const exp = (r.data as { expiresAt?: string } | null)?.expiresAt;
      if (exp) useSessionStore.getState().setExpiresAt(exp);
      setRenewMsg("Session renewed.");
    } else {
      useSessionStore.getState().setRenewalFailed(true);
      setRenewMsg(r.code === "EVENT_OVER" ? "This event has ended — sessions can no longer be renewed." : (r.message ?? "Could not renew right now."));
    }
  };

  const sessionLeft = session.expiresAt ? Date.parse(session.expiresAt) - nowMs : null;
  const manifestAge = session.manifest ? nowMs - Date.parse(session.manifest.lastDeltaAt ?? session.manifest.syncedAt) : null;

  return (
    <div className="min-h-dvh bg-surface-0">
      <header
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-surface-0/95 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={() => router.push("/scan")}
          aria-label="Back to scanner"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            "text-ink transition-colors active:bg-surface-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          )}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
      </header>

      <div className="space-y-4 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <Section title="This scanner">
          <InfoRow label="Entrance" value={scanner?.name || "—"} />
          <InfoRow label="Event" value={scanner?.eventName || `#${scanner?.eventId || "—"}`} />
          <InfoRow label="Signed in with" value={accessMethod === "account" ? "Account" : "Access code"} />
          <InfoRow label="Admits" value={admitsLabel(scanner?.allowedTicketTypeIds ?? [], session.manifest?.ticketTypes ?? [])} />
        </Section>

        <Section title="Scanning">
          <ScanModeToggleComponent />
        </Section>

        <Section title="Camera" id="camera" icon={<Camera className="h-4 w-4" aria-hidden="true" />}>
          {devices.length === 0 ? (
            <p className="text-xs text-ink-muted">Camera list appears once the camera has been used once.</p>
          ) : (
            <div role="radiogroup" aria-label="Camera" className="space-y-2">
              <CameraOption label="Automatic (rear camera)" selected={!preferredCameraId} onSelect={() => setPreferredCameraId(null)} />
              {devices.map((d, i) => (
                <CameraOption key={d.deviceId} label={d.label || `Camera ${i + 1}`} selected={preferredCameraId === d.deviceId} onSelect={() => setPreferredCameraId(d.deviceId)} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Offline data" icon={<Database className="h-4 w-4" aria-hidden="true" />}>
          {session.idbUnavailable ? (
            <p className="text-xs text-ink-muted">Not available on this device — tickets are verified live only.</p>
          ) : session.manifest ? (
            <>
              <InfoRow label="Tickets" value={session.manifest.count.toLocaleString()} />
              <InfoRow label="Last synced" value={manifestAge != null ? `${formatDuration(manifestAge)} ago` : "—"} />
              <InfoRow label="Scan window" value={`${formatTime(session.manifest.window.opensAt)} – ${formatTime(session.manifest.window.closesAt)}`} />
            </>
          ) : (
            <p className="text-xs text-ink-muted">No offline data yet.</p>
          )}
          {session.manifestError && <p className="text-xs text-danger">Last sync failed: {session.manifestError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => void syncManifestNow("delta")} isLoading={session.manifestSync !== "idle"} loadingText="Syncing…">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Sync now
            </Button>
            <Button variant="ghost" size="md" onClick={() => void syncManifestNow("full")} disabled={session.manifestSync !== "idle"}>
              Full refresh
            </Button>
          </div>
        </Section>

        <Section title="Session" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
          <InfoRow label="State" value={session.auth === "reauth_required" ? `Sign in needed (${session.authErrorCode ?? "expired"})` : session.auth === "authenticated" ? "Active" : "—"} />
          <InfoRow label="Expires" value={session.expiresAt ? `${formatTime(session.expiresAt)}${sessionLeft != null && sessionLeft > 0 ? ` (in ${formatDuration(sessionLeft)})` : ""}` : "—"} />
          <InfoRow label="Device id" value={session.deviceId ?? "—"} mono />
          {renewMsg && <p className="text-xs text-ink-muted">{renewMsg}</p>}
          <Button variant="secondary" size="md" className="w-full" onClick={renewNow} isLoading={renewing} loadingText="Renewing…" disabled={session.auth === "reauth_required"}>
            Renew now
          </Button>
        </Section>

        <Section title="Queue" icon={<CloudOff className="h-4 w-4" aria-hidden="true" />}>
          <InfoRow label="Waiting to verify" value={String(queue.unverified)} />
          <InfoRow label="Needs review" value={String(queue.needsReview)} />
          <InfoRow label="Stuck" value={String(queue.stalled + queue.failed)} />
          {queue.stalled > 0 && (
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              onClick={async () => {
                await retryStalled();
                requestQueueDrain();
              }}
            >
              Retry stuck scans
            </Button>
          )}
        </Section>

        <Section title="Diagnostics" icon={<Stethoscope className="h-4 w-4" aria-hidden="true" />}>
          <InfoRow label="Build" value={BUILD_ID} mono />
          <InfoRow label="Network" value={session.connectivity} />
          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={async () => {
                setDiag(await copyDiagnostics());
              }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Export diagnostics
            </Button>
            <Button variant="ghost" size="md" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          </div>
          {diag && (
            <textarea
              readOnly
              value={diag}
              aria-label="Diagnostics"
              className="mt-2 h-40 w-full rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] text-ink"
            />
          )}
        </Section>

        {confirming && unresolved > 0 && (
          <div role="alert" className="rounded-2xl border border-used/40 bg-used/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-used">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              {unresolved} scan{unresolved === 1 ? "" : "s"} not yet resolved
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Signing out now leaves them on this device unverified. Stay connected for a moment and they&apos;ll upload on their own, or sign out
              anyway if you&apos;re handing this phone over.
            </p>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <Button variant="danger" size="lg" onClick={handleSignOutClick} isLoading={isSigningOut} loadingText="Signing out…" className="w-full">
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {confirming && unresolved > 0 ? "Sign out anyway" : "Sign out"}
          </Button>
          {confirming && unresolved > 0 && (
            <Button variant="secondary" size="lg" onClick={() => setConfirming(false)} className="w-full">
              Stay signed in
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Names come from the offline data header; before the first sync, fall back to a count. */
function admitsLabel(ids: number[], types: Array<{ id: number; name: string }>): string {
  if (ids.length === 0) return "All ticket types";
  const names = ids.map((id) => types.find((t) => t.id === id)?.name).filter((n): n is string => !!n);
  if (names.length === ids.length) return names.join(", ");
  return `${ids.length} ticket type${ids.length === 1 ? "" : "s"}`;
}

function Section({ title, id, icon, children }: { title: string; id?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-line bg-surface-1 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Text variant="p2" color="muted">
        {label}
      </Text>
      <Text variant="span2" className={cn("min-w-0 truncate text-right", mono && "font-mono text-xs")}>
        {value}
      </Text>
    </div>
  );
}

function CameraOption({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
        selected ? "border-brand bg-brand/10 text-ink" : "border-line bg-surface-2 text-ink active:bg-line-soft"
      )}
    >
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-brand" : "border-ink-faint")} aria-hidden="true">
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default SettingsPanelComponent;
