"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  DEFAULT_SCAN_MODE,
  type AccessMethod,
  type ScanMode,
  type ScannerInfo,
} from "@/types/scanner.types";

interface AuthState {
  /** Non-sensitive scanner profile (from login), safe to persist for offline display. */
  scanner: ScannerInfo | null;
  /** Which login method was used (client-derived; the backend no longer sends it). */
  accessMethod: AccessMethod | null;
  /** Device-only throughput preference. */
  scanMode: ScanMode;
  /** Device-only. Independent of scanMode — a loud gate wants fast AND silent. */
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  /** MediaDeviceInfo.deviceId of the camera the operator picked, if any. */
  preferredCameraId: string | null;
}

interface AuthActions {
  login: (scanner: ScannerInfo, accessMethod: AccessMethod) => void;
  logout: () => void;
  setScanMode: (scanMode: ScanMode) => void;
  setSoundEnabled: (soundEnabled: boolean) => void;
  setVibrationEnabled: (vibrationEnabled: boolean) => void;
  setPreferredCameraId: (id: string | null) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  scanner: null,
  accessMethod: null,
  scanMode: DEFAULT_SCAN_MODE,
  soundEnabled: true,
  vibrationEnabled: true,
  preferredCameraId: null,
};

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        login: (scanner, accessMethod) => set({ scanner, accessMethod }),
        // Keep the device's preferences across logout/login.
        logout: () => set({ scanner: null, accessMethod: null }),
        setScanMode: (scanMode) => set({ scanMode }),
        setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
        setVibrationEnabled: (vibrationEnabled) => set({ vibrationEnabled }),
        setPreferredCameraId: (preferredCameraId) => set({ preferredCameraId }),
      }),
      {
        name: "scanner-auth",
        version: 3,
        // SECURITY: the auth token is an httpOnly+Secure cookie set server-side by
        // the BFF — it is NEVER stored here. We persist only the non-sensitive
        // profile and device prefs. The reusable access code is never persisted.
        partialize: (s) => ({
          scanner: s.scanner,
          accessMethod: s.accessMethod,
          scanMode: s.scanMode,
          soundEnabled: s.soundEnabled,
          vibrationEnabled: s.vibrationEnabled,
          preferredCameraId: s.preferredCameraId,
        }),
        migrate: (persisted, version) => {
          const state = (persisted ?? {}) as Partial<Omit<AuthState, "scanMode">> & { scanMode?: string };
          if (version >= 3) return state as AuthState;
          const legacy = state.scanMode;
          return {
            ...initialState,
            ...state,
            scanMode: version >= 2 ? ((legacy as ScanMode) ?? DEFAULT_SCAN_MODE) : legacy === "automatic" ? "fast" : "confirm",
            soundEnabled: version >= 2 ? (state.soundEnabled ?? true) : legacy !== "silent",
            vibrationEnabled: true,
            preferredCameraId: null,
          } as AuthState;
        },
      }
    ),
    { name: "AuthStore", enabled: process.env.NODE_ENV !== "production" }
  )
);
