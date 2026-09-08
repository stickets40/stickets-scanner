/**
 * Camera failure taxonomy.
 *
 * The scanner previously funnelled every possible camera failure — permission
 * denied, no camera, camera held by another app, an insecure origin, a stream
 * timeout — into one hardcoded string about browser permissions. The worst
 * case was a scanner served over plain HTTP on a venue LAN: every device shows
 * a permissions message forever while the actual fix is HTTPS, so the operator
 * hunts through browser settings at the door instead of escalating.
 */

export type CameraErrorKind =
  | "permission"
  | "insecure"
  | "not-found"
  | "in-use"
  | "constraints"
  | "unsupported"
  | "unknown";

export interface CameraErrorInfo {
  kind: CameraErrorKind;
  title: string;
  body: string;
  /** Whether remounting the scanner has any chance of helping. */
  canRetry: boolean;
}

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

function permissionInstructions(): string {
  switch (detectPlatform()) {
    case "ios":
      // The iOS re-grant path is genuinely non-obvious and is NOT in Safari's
      // own settings menu — it lives in the address-bar "aA" menu.
      return "In Safari, tap the “aA” icon in the address bar, choose Website Settings, and set Camera to Allow. Then reload. If this app was added to your Home Screen, grant camera access in Settings › Stickets Scanner instead.";
    case "android":
      return "In Chrome, tap the lock icon to the left of the address bar, open Permissions, and set Camera to Allow. Then reload.";
    default:
      return "Open the site permissions for this page in your browser and set Camera to Allow, then reload.";
  }
}

export function describeCameraError(error: unknown): CameraErrorInfo {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  // Checked before anything else: on an insecure origin getUserMedia is simply
  // absent, and every downstream error is a misleading symptom of this.
  if (
    /secure context|insecure|https/i.test(message) ||
    (typeof window !== "undefined" && !window.isSecureContext)
  ) {
    return {
      kind: "insecure",
      title: "Camera blocked on this connection",
      body: "Browsers only allow camera access over HTTPS. This page was loaded over an insecure connection, so no permission change will fix it. Ask your event contact for the secure (https://) address for this scanner.",
      canRetry: false,
    };
  }

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return {
      kind: "permission",
      title: "Camera permission denied",
      body: permissionInstructions(),
      // Retry cannot re-prompt once permission is persistently denied.
      canRetry: false,
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      kind: "not-found",
      title: "No camera found",
      body: "This device doesn't report a usable camera. If it has an external or clip-on camera, reconnect it and retry — otherwise use a different phone for this gate.",
      canRetry: true,
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      kind: "in-use",
      title: "Camera is busy",
      body: "Another app is using the camera. Close any camera, video-call or streaming app running in the background, then retry.",
      canRetry: true,
    };
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      kind: "constraints",
      title: "Camera not compatible",
      body: "This device's camera doesn't support the settings the scanner asked for. Retry — if it keeps failing, use a different phone for this gate.",
      canRetry: true,
    };
  }

  if (/stream api|not support/i.test(message)) {
    return {
      kind: "unsupported",
      title: "Browser can't use the camera",
      body: "This browser doesn't support in-page camera access. Open the scanner in Safari (iPhone) or Chrome (Android) instead.",
      canRetry: false,
    };
  }

  return {
    kind: "unknown",
    title: "Camera didn't start",
    body: "The camera failed to start. Retry — if it keeps happening, close and reopen the app.",
    canRetry: true,
  };
}
