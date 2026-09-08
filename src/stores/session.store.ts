"use client";

import { create } from "zustand";
import type { ConnectivityStatus } from "@/lib/connectivity";
import type { QueueCounts } from "@/lib/scan-queue";

/**
 * Runtime session state (NOT persisted): what the chrome shows and what the
 * engine consults. Auth is a state machine, not a boolean:
 *
 *   unknown          before the first request of this page load
 *   authenticated    a request succeeded with the cookie
 *   reauth_required  the backend rejected the session (code says why) — the
 *                    inline re-auth sheet takes over; scanning continues offline
 *   offline_only     no session and no network: the shell runs on the manifest
 */
export type AuthState = "unknown" | "authenticated" | "reauth_required" | "offline_only";

export interface ManifestSummary {
  eventId: string;
  eventName: string;
  count: number;
  syncedAt: string;
  lastDeltaAt: string | null;
  window: { opensAt: string; closesAt: string };
  ticketTypes: Array<{ id: number; name: string }>;
}

interface SessionState {
  auth: AuthState;
  authErrorCode: string | null;
  expiresAt: string | null;
  renewalFailed: boolean;
  connectivity: ConnectivityStatus;
  rateLimitedUntil: number | null;
  idbUnavailable: boolean;
  manifest: ManifestSummary | null;
  manifestSync: "idle" | "full" | "delta" | "error";
  manifestError: string | null;
  updateAvailable: boolean;
  venue: { admitted: number; total: number; asOf: string } | null;
  venueStale: boolean;
  queue: QueueCounts;
  deviceId: string | null;
  swState: "unsupported" | "registering" | "active" | "failed";
}

interface SessionActions {
  setAuth: (auth: AuthState, code?: string | null) => void;
  setExpiresAt: (iso: string | null) => void;
  setRenewalFailed: (failed: boolean) => void;
  setConnectivity: (status: ConnectivityStatus, rateLimitedUntil?: number | null) => void;
  setIdbUnavailable: (unavailable: boolean) => void;
  setManifest: (summary: ManifestSummary | null) => void;
  setManifestSync: (state: SessionState["manifestSync"], error?: string | null) => void;
  setUpdateAvailable: (available: boolean) => void;
  setVenue: (venue: SessionState["venue"], stale?: boolean) => void;
  setQueue: (counts: QueueCounts) => void;
  setDeviceId: (id: string) => void;
  setSwState: (state: SessionState["swState"]) => void;
}

export const EMPTY_QUEUE_COUNTS: QueueCounts = { pending: 0, syncing: 0, needsReview: 0, stalled: 0, failed: 0, unverified: 0 };

export const useSessionStore = create<SessionState & SessionActions>()((set) => ({
  auth: "unknown",
  authErrorCode: null,
  expiresAt: null,
  renewalFailed: false,
  connectivity: "online",
  rateLimitedUntil: null,
  idbUnavailable: false,
  manifest: null,
  manifestSync: "idle",
  manifestError: null,
  updateAvailable: false,
  venue: null,
  venueStale: false,
  queue: EMPTY_QUEUE_COUNTS,
  deviceId: null,
  swState: "unsupported",

  setAuth: (auth, code = null) => set({ auth, authErrorCode: auth === "reauth_required" ? code : null }),
  setExpiresAt: (expiresAt) => set({ expiresAt }),
  setRenewalFailed: (renewalFailed) => set({ renewalFailed }),
  setConnectivity: (connectivity, rateLimitedUntil = null) => set({ connectivity, rateLimitedUntil }),
  setIdbUnavailable: (idbUnavailable) => set({ idbUnavailable }),
  setManifest: (manifest) => set({ manifest }),
  setManifestSync: (manifestSync, error = null) => set({ manifestSync, manifestError: error }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setVenue: (venue, stale = false) => set({ venue, venueStale: stale }),
  setQueue: (queue) => set({ queue }),
  setDeviceId: (deviceId) => set({ deviceId }),
  setSwState: (swState) => set({ swState }),
}));
