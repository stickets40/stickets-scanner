"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeCameraError, type CameraErrorInfo } from "@/lib/camera-error";
import { beacon } from "@/lib/telemetry";

export type CameraPhase = "starting" | "live" | "error_transient" | "error_final";

export interface CameraLifecycle {
  phase: CameraPhase;
  error: CameraErrorInfo | null;
  attempt: number;
  /** Bump to remount the <Scanner>. */
  mountKey: number;
  constraints: MediaTrackConstraints;
  onError: (error: unknown) => void;
  onReady: () => void;
  retry: () => void;
  remount: () => void;
}

const MAX_TRANSIENT_RETRIES = 3;
/** After this long hidden, iOS Safari tends to hand back a black <video>. */
const REMOUNT_AFTER_HIDDEN_MS = 5000;

/**
 * Camera state machine. Transient failures (camera busy, constraints, a
 * stream that died) remount with backoff up to three times; a persistent
 * denial or an insecure origin is final and shows instructions. A preferred
 * camera that fails on constraints is dropped in favour of "any rear camera".
 */
export function useCameraLifecycle(preferredCameraId: string | null): CameraLifecycle {
  const [phase, setPhase] = useState<CameraPhase>("starting");
  const [error, setError] = useState<CameraErrorInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [ignorePreferred, setIgnorePreferred] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef<number | null>(null);

  const constraints: MediaTrackConstraints =
    preferredCameraId && !ignorePreferred ? { deviceId: { exact: preferredCameraId } } : { facingMode: { ideal: "environment" } };

  const remount = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setError(null);
    setPhase("starting");
    setMountKey((k) => k + 1);
  }, []);

  const retry = useCallback(() => {
    setAttempt(0);
    setIgnorePreferred(false);
    remount();
  }, [remount]);

  const onReady = useCallback(() => {
    setPhase("live");
    setAttempt(0);
  }, []);

  const onError = useCallback(
    (raw: unknown) => {
      const info = describeCameraError(raw);
      beacon("camera_error", { kind: info.kind, attempt });
      setError(info);
      if (info.kind === "constraints" && preferredCameraId && !ignorePreferred) {
        // The chosen camera cannot satisfy the request; fall back to any rear camera.
        setIgnorePreferred(true);
        remount();
        return;
      }
      if (!info.canRetry || attempt >= MAX_TRANSIENT_RETRIES) {
        setPhase("error_final");
        return;
      }
      setPhase("error_transient");
      const delay = 500 * 2 ** attempt;
      setAttempt((a) => a + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(remount, delay);
    },
    [attempt, ignorePreferred, preferredCameraId, remount]
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > REMOUNT_AFTER_HIDDEN_MS) {
        hiddenAt.current = null;
        remount();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [remount]);

  // Switching the preferred camera from settings restarts the stream.
  useEffect(() => {
    setIgnorePreferred(false);
    setAttempt(0);
    remount();
  }, [preferredCameraId, remount]);

  return { phase, error, attempt, mountKey, constraints, onError, onReady, retry, remount };
}
