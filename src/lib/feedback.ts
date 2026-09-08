/**
 * Non-visual scan feedback: one distinct tone and one distinct haptic per
 * verdict FAMILY. Fires only on a real verdict (the QR library's own `sound`
 * prop plays on detection, before anything was validated, and is off).
 *
 * iOS Safari has no navigator.vibrate: there the tone and the full-screen
 * colour carry the signal alone.
 */
import type { VerdictKind } from "@/types/verdict.types";

type Tone = { freq: number; start: number; duration: number; gain?: number };

export type FeedbackFamily =
  | "admit"
  | "admit_offline"
  | "used"
  | "wrong_gate"
  | "invalid"
  | "window"
  | "choice"
  | "pending"
  | "denied"
  | "undone";

export const FAMILY_BY_KIND: Record<VerdictKind, FeedbackFamily> = {
  success: "admit",
  success_offline: "admit_offline",
  admitted_unverified: "admit_offline",
  already_used: "used",
  already_used_offline: "used",
  wrong_scanner: "wrong_gate",
  invalid: "invalid",
  outside_window: "window",
  authentic_not_in_manifest: "choice",
  unverifiable: "choice",
  unverifiable_denied: "denied",
  error: "pending",
  undone: "undone",
};

/** Tones differ by CONTOUR, not just pitch — recognisable through a PA and ear protection. */
const TONES: Record<FeedbackFamily, Tone[]> = {
  admit: [
    { freq: 880, start: 0, duration: 0.07 },
    { freq: 1320, start: 0.07, duration: 0.11 },
  ],
  // Same rising pair, slightly softer and with a third short note: "in, but unconfirmed".
  admit_offline: [
    { freq: 880, start: 0, duration: 0.07, gain: 0.16 },
    { freq: 1320, start: 0.07, duration: 0.09, gain: 0.16 },
    { freq: 1320, start: 0.22, duration: 0.05, gain: 0.12 },
  ],
  used: [
    { freq: 320, start: 0, duration: 0.1 },
    { freq: 320, start: 0.16, duration: 0.1 },
  ],
  wrong_gate: [
    { freq: 760, start: 0, duration: 0.09 },
    { freq: 520, start: 0.1, duration: 0.14 },
  ],
  invalid: [{ freq: 200, start: 0, duration: 0.34, gain: 0.28 }],
  // Three even mid notes: "not now" — neither a no nor a go.
  window: [
    { freq: 520, start: 0, duration: 0.07 },
    { freq: 520, start: 0.11, duration: 0.07 },
    { freq: 520, start: 0.22, duration: 0.07 },
  ],
  // Rising question: the operator has to decide.
  choice: [
    { freq: 620, start: 0, duration: 0.08, gain: 0.16 },
    { freq: 830, start: 0.12, duration: 0.12, gain: 0.16 },
  ],
  pending: [{ freq: 460, start: 0, duration: 0.06, gain: 0.12 }],
  denied: [{ freq: 260, start: 0, duration: 0.18, gain: 0.2 }],
  undone: [
    { freq: 700, start: 0, duration: 0.06, gain: 0.14 },
    { freq: 500, start: 0.08, duration: 0.1, gain: 0.14 },
  ],
};

const VIBRATIONS: Record<FeedbackFamily, number | number[]> = {
  admit: 35,
  admit_offline: [35, 60, 20],
  used: [40, 90, 40],
  wrong_gate: [30, 70, 30, 70, 30],
  invalid: 220,
  window: [30, 60, 30, 60, 30],
  choice: [20, 80, 60],
  pending: 15,
  denied: 120,
  undone: [20, 40, 20],
};

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from any early tap so the very first verdict of the shift is audible. */
export function unlockAudio(): void {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume();
}

function playTones(tones: Tone[]): void {
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const now = c.currentTime;
  for (const t of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = t.freq;
    const peak = t.gain ?? 0.2;
    const startAt = now + t.start;
    const endAt = startAt + t.duration;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibration is an enhancement — never let it break a scan */
  }
}

/** Signal a verdict. `silent` mutes the tone only; `noVibration` mutes haptics. */
export function signal(kind: VerdictKind, opts?: { silent?: boolean; noVibration?: boolean }): void {
  const family = FAMILY_BY_KIND[kind];
  if (!opts?.silent) playTones(TONES[family]);
  if (!opts?.noVibration) vibrate(VIBRATIONS[family]);
}
