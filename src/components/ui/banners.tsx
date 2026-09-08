"use client";

import { usePathname } from "next/navigation";
import { Database, WifiOff } from "lucide-react";
import { useSessionStore } from "@/stores/session.store";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Persistent conditions that change how the operator should work. Rendered
 * under the scanner header, never over the verdict.
 */
export default function Banners() {
  const pathname = usePathname();
  const idbUnavailable = useSessionStore((s) => s.idbUnavailable);
  const auth = useSessionStore((s) => s.auth);
  const connectivity = useSessionStore((s) => s.connectivity);
  const scanner = useAuthStore((s) => s.scanner);
  if (pathname !== "/scan" || !scanner) return null;

  const items: Array<{ key: string; icon: React.ReactNode; text: string }> = [];
  if (idbUnavailable) {
    items.push({
      key: "idb",
      icon: <Database className="h-4 w-4 shrink-0" aria-hidden="true" />,
      text: "Offline data can't be stored on this device — tickets are verified live only.",
    });
  }
  if (auth === "reauth_required" && connectivity === "offline") {
    items.push({
      key: "offline-only",
      icon: <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />,
      text: "Session expired and offline — verifying from offline data; sign in again when connected.",
    });
  }
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 z-10 flex flex-col gap-1 px-4" style={{ top: "calc(env(safe-area-inset-top) + 4.5rem)" }}>
      {items.map((b) => (
        <p key={b.key} className="pointer-events-auto flex items-center gap-2 rounded-xl bg-used/90 px-3 py-2 text-xs font-medium text-used-ink backdrop-blur-sm" role="status">
          {b.icon}
          {b.text}
        </p>
      ))}
    </div>
  );
}
