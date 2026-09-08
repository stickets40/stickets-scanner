"use client";

import { useEffect, useState } from "react";
import { KeyRound, WifiOff } from "lucide-react";
import { useSessionStore } from "@/stores/session.store";
import { useAuthStore } from "@/stores/auth.store";
import { AUTH_REQUIRED_EVENT } from "@/lib/events";
import Sheet from "@/components/ui/sheet";
import Button from "@/components/ui/button";
import AccessCodeLoginComponent from "@/components/login/access-code-login.component";
import AccountLoginComponent from "@/components/login/account-login.component";
import { cn } from "@/lib/cn";

const COPY_BY_CODE: Record<string, { title: string; body: string }> = {
  SCANNER_TOKEN_EXPIRED: { title: "Session expired", body: "Sign in again to keep verifying live. Scans made meanwhile are checked against offline data and synced afterwards." },
  SCANNER_TOKEN_REVOKED: { title: "Access was reset", body: "The organiser reset this entrance's credentials. Ask them for the new access code." },
  SCANNER_INACTIVE: { title: "Entrance deactivated", body: "The organiser deactivated this scanner. Check with them before continuing." },
  EVENT_OVER: { title: "Event has ended", body: "Scanning sessions close 24 hours after the doors. Sign in to a current event." },
  NO_SESSION: { title: "Signed out", body: "This device has no active session. Sign in to verify live." },
  SCANNER_EVENT_MISSING: { title: "Scanner not attached to an event", body: "Ask the organiser to check this scanner's setup." },
};

interface Props {
  forceOpen: boolean;
  onClosed: () => void;
}

/**
 * Inline re-authentication. Never a hard redirect: the camera keeps working
 * from offline data behind this sheet, and the queue resumes the moment a new
 * session lands. The operator can put it away and reopen it from the header.
 */
const ReauthSheetComponent = ({ forceOpen, onClosed }: Props) => {
  const auth = useSessionStore((s) => s.auth);
  const code = useSessionStore((s) => s.authErrorCode);
  const connectivity = useSessionStore((s) => s.connectivity);
  const accessMethod = useAuthStore((s) => s.accessMethod);
  const [dismissed, setDismissed] = useState(false);
  const [tab, setTab] = useState<"access_code" | "account">(accessMethod === "account" ? "account" : "access_code");

  useEffect(() => {
    const onRequired = () => setDismissed(false);
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, []);

  useEffect(() => {
    if (forceOpen) setDismissed(false);
  }, [forceOpen]);

  const open = auth === "reauth_required" && (!dismissed || forceOpen);
  if (!open) return null;
  const copy = COPY_BY_CODE[code ?? ""] ?? { title: "Sign in again", body: "The server no longer accepts this device's session." };
  const offline = connectivity === "offline";

  const close = () => {
    setDismissed(true);
    onClosed();
  };

  return (
    <Sheet open onClose={close} title={copy.title} description={copy.body}>
      {offline ? (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-3 text-sm text-ink-muted">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            You&apos;re offline. Scanning continues from this device&apos;s offline data; sign in again when the connection returns.
          </p>
          <Button variant="secondary" className="w-full" onClick={close}>
            Keep scanning offline
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
            {(["access_code", "account"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors",
                  tab === t ? "bg-brand text-white" : "bg-transparent text-ink-muted active:bg-line-soft"
                )}
              >
                {t === "access_code" ? "Access code" : "Account"}
              </button>
            ))}
          </div>
          {tab === "access_code" ? <AccessCodeLoginComponent onSuccess={close} compact /> : <AccountLoginComponent onSuccess={close} compact />}
          <button type="button" onClick={close} className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-ink-muted">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Later — keep scanning offline
          </button>
        </div>
      )}
    </Sheet>
  );
};

export default ReauthSheetComponent;
