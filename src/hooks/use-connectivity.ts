"use client";

import { useEffect, useState } from "react";
import { getConnectivityMonitor, type ConnectivityState } from "@/lib/connectivity";
import { useSessionStore } from "@/stores/session.store";

/** Reactive connectivity estimate (online / degraded / offline), mirrored into the session store. */
export function useConnectivity(): ConnectivityState {
  const monitor = getConnectivityMonitor();
  const [state, setState] = useState<ConnectivityState>(() => monitor.getState());

  useEffect(() => {
    const push = (s: ConnectivityState) => {
      setState(s);
      useSessionStore.getState().setConnectivity(s.status, s.rateLimitedUntil);
    };
    push(monitor.getState());
    const unsubscribe = monitor.subscribe(push);
    return () => {
      unsubscribe();
    };
  }, [monitor]);

  return state;
}
