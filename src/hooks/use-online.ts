"use client";

import { useEffect, useState } from "react";

/**
 * Reactive online/offline status. Starts optimistic (true) to avoid an
 * offline flash during hydration, then syncs to navigator.onLine and updates on
 * the browser online/offline events.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
