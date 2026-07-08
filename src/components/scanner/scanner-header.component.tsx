"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth.store";
import { Text } from "@/components/ui/text";

const ScannerHeaderComponent = () => {
  const scanner = useAuthStore((s) => s.scanner);

  const displayName = scanner?.name || "Scanner";
  const eventLabel = scanner?.eventName || `Event #${scanner?.eventId ?? "—"}`;

  return (
    <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
      <div className="flex flex-col">
        <Text variant="h7" color="white">
          {displayName}
        </Text>
        <Text variant="p3" className="text-white/70">
          {eventLabel}
        </Text>
      </div>
      <Link
        href="/settings"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors active:bg-white/30"
      >
        <Settings className="h-5 w-5 text-white" />
      </Link>
    </header>
  );
};

export default ScannerHeaderComponent;
