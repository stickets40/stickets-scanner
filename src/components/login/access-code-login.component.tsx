"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { api, describeFailure } from "@/lib/api";
import { getDeviceId } from "@/lib/device-id";
import { requestPersistentStorage } from "@/lib/idb";
import { precacheShell } from "@/lib/sw-registration";
import { sessionRestored } from "@/lib/runtime";
import { useAuthStore } from "@/stores/auth.store";
import { loginResultSchema } from "@/types/scanner.types";
import { unlockAudio } from "@/lib/feedback";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";

const CODE_LENGTH = 8;
const SEPARATOR_AT = 4;

/** Strip everything that is not part of a code, cap it, upper-case it. */
const normalise = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, CODE_LENGTH);

/** "12345678" -> "1234-5678". The dash is presentation only. */
const format = (clean: string): string =>
  clean.length > SEPARATOR_AT
    ? `${clean.slice(0, SEPARATOR_AT)}-${clean.slice(SEPARATOR_AT)}`
    : clean;

/**
 * Where the caret belongs after re-formatting: after the same number of CODE
 * characters it had in front of it before, ignoring the dash entirely. Without
 * this, editing anywhere but the end throws the caret to the end on every
 * keystroke.
 */
const caretAfterFormat = (formatted: string, codeCharsBefore: number): number => {
  if (codeCharsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] !== "-") seen++;
    if (seen === codeCharsBefore) return i + 1;
  }
  return formatted.length;
};

interface Props {
  /** Called instead of navigating to /scan (inline re-auth). */
  onSuccess?: () => void;
  compact?: boolean;
}

const AccessCodeLoginComponent = ({ onSuccess, compact }: Props) => {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  /** The canonical 8 characters, with no dash. The field renders `format(code)`. */
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * A MASK, not a formatter. The bug this fixes is CARET LOSS, not a bad format.
   *
   * The previous version stored the formatted string and returned it unchanged for
   * any keystroke the mask rejects — a "-", a space, a punctuation mark. React then
   * saw no state change, so it restored the DOM value it already believed in and,
   * in doing so, moved the caret to the END of the field. Silently: nothing about
   * the visible text changed, so there was no clue it had happened.
   *
   * From the gate operator's side that reads as: put the caret in the middle to fix
   * a digit, press "-", nothing appears (fine, the mask inserts it) — press it again,
   * still nothing — then press Backspace expecting to remove the dash and a REAL
   * character disappears instead, from wherever the caret silently went. Which is
   * exactly the report: "typing - does nothing, and after pressing it 2 times it
   * starts deleting what is already written."
   *
   * Two things are therefore deliberate below. The caret is restored explicitly on
   * every input event, including the ones that change nothing — that is the actual
   * fix. And the canonical value is written back onto the DOM node directly rather
   * than left to React's controlled-input restore, so the field cannot drift on a
   * browser whose composition or autofill behaviour defeats that restore (this is a
   * phone PWA; jsdom is not the environment that matters).
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? el.value.length;
    const codeCharsBefore = normalise(el.value.slice(0, caret)).length;

    const clean = normalise(el.value);
    const display = format(clean);

    // Unconditional, and before setState: React will not resync a value it does not
    // consider changed, so the DOM has to be corrected here.
    el.value = display;
    const next = caretAfterFormat(display, codeCharsBefore);
    el.setSelectionRange(next, next);

    setCode(clean);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // The submit tap is the gesture that lets us start the AudioContext.
    unlockAudio();
    if (code.length !== CODE_LENGTH) {
      setError("Enter the full 8-character access code.");
      return;
    }
    const accessCode = format(code);
    setIsSubmitting(true);
    const r = await api.post("auth/access-code", { accessCode, deviceId: getDeviceId() }, { timeoutMs: 10_000, untracked: true });
    setIsSubmitting(false);
    if (!r.ok) {
      setError(describeFailure(r, "That access code wasn't accepted."));
      return;
    }
    const parsed = loginResultSchema.safeParse(r.data);
    if (!parsed.success) {
      setError("Unexpected answer from the server. Try again.");
      return;
    }
    login(parsed.data.scanner, "access_code");
    void requestPersistentStorage();
    precacheShell();
    sessionRestored();
    if (onSuccess) onSuccess();
    else router.push("/scan");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Access code"
        name="accessCode"
        placeholder="XXXX-XXXX"
        value={format(code)}
        onChange={handleChange}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="one-time-code"
        inputMode="text"
        enterKeyHint="go"
        error={error ?? undefined}
        helperText={error || compact ? undefined : "Access codes are event specific and may expire."}
        // Mono keeps 0/O and 1/I distinguishable — this is a code read aloud
        // from a printout in a dark room.
        className="font-mono tracking-[0.15em]"
        startContent={<KeyRound className="h-4 w-4" aria-hidden="true" />}
      />
      <Button type="submit" size={compact ? "lg" : "xl"} isLoading={isSubmitting} className="w-full">
        {compact ? "Sign in" : "Open scanner"}
      </Button>
    </form>
  );
};

export default AccessCodeLoginComponent;
