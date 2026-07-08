"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import Button from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import ScanModeToggleComponent from "./scan-mode-toggle.component";

const SettingsPanelComponent = () => {
  const router = useRouter();
  const scanner = useAuthStore((s) => s.scanner);
  const accessMethod = useAuthStore((s) => s.accessMethod);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    // Clear the httpOnly cookie server-side, then wipe local state.
    try {
      await api.post("auth/logout");
    } catch {
      /* best-effort — still clear locally */
    }
    logout();
    router.push("/login");
  };

  return (
    <div className="min-h-dvh bg-background-light">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-3 shadow-sm">
        <button
          onClick={() => router.push("/scan")}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors active:bg-background-light"
        >
          <ArrowLeft className="h-5 w-5 text-text-primary" />
        </button>
        <Text variant="h5">Settings</Text>
      </header>

      <div className="space-y-4 p-4">
        {/* Scanner Info */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <Text variant="h7" className="mb-3">
            Scanner Info
          </Text>
          <div className="space-y-2">
            <InfoRow label="Name" value={scanner?.name || "—"} />
            <InfoRow
              label="Event"
              value={scanner?.eventName || `#${scanner?.eventId || "—"}`}
            />
            <InfoRow
              label="Access"
              value={
                accessMethod === "account" ? "Account Login" : "Access Code"
              }
            />
            <InfoRow
              label="Ticket Types"
              value={
                scanner?.allowedTicketTypeIds?.length
                  ? scanner.allowedTicketTypeIds.join(", ")
                  : "All"
              }
            />
          </div>
        </div>

        {/* Scan Mode */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <ScanModeToggleComponent />
        </div>

        {/* Logout */}
        <Button
          variant="secondary"
          onClick={handleLogout}
          className="w-full text-danger"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </Button>
      </div>
    </div>
  );
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <Text variant="p2" color="secondary">{label}</Text>
      <Text variant="span2">{value}</Text>
    </div>
  );
}

export default SettingsPanelComponent;
