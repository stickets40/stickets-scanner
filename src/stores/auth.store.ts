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
  /** Device-only preference; the backend dropped scan_mode entirely. */
  scanMode: ScanMode;
}

interface AuthActions {
  login: (scanner: ScannerInfo, accessMethod: AccessMethod) => void;
  logout: () => void;
  setScanMode: (scanMode: ScanMode) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  scanner: null,
  accessMethod: null,
  scanMode: DEFAULT_SCAN_MODE,
};

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        login: (scanner, accessMethod) => set({ scanner, accessMethod }),
        // Keep the device's scanMode preference across logout/login.
        logout: () => set({ scanner: null, accessMethod: null }),
        setScanMode: (scanMode) => set({ scanMode }),
      }),
      {
        name: "scanner-auth",
        // SECURITY: the auth token is an httpOnly+Secure cookie set server-side by
        // the BFF — it is NEVER stored here. We persist only the non-sensitive
        // profile and device prefs. The reusable access code is never persisted.
        partialize: (s) => ({
          scanner: s.scanner,
          accessMethod: s.accessMethod,
          scanMode: s.scanMode,
        }),
      }
    ),
    {
      name: "AuthStore",
      enabled: process.env.NODE_ENV !== "production",
    }
  )
);
