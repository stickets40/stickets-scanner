"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import Loading from "./loading";

/**
 * Renders the scanner shell when this device has ever signed in (persisted
 * profile). An EXPIRED session still renders — the re-auth sheet handles it
 * inline and offline scanning continues. Only a device with no profile at all
 * is sent to /login.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const scanner = useAuthStore((s) => s.scanner);
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !scanner) router.replace("/login");
  }, [hydrated, scanner, router]);

  if (!hydrated || !scanner) return <Loading />;
  return <>{children}</>;
}

export default SessionGate;
