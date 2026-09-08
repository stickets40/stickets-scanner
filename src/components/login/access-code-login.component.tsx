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

interface Props {
  /** Called instead of navigating to /scan (inline re-auth). */
  onSuccess?: () => void;
  compact?: boolean;
}

const AccessCodeLoginComponent = ({ onSuccess, compact }: Props) => {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatCode = (raw: string): string => {
    const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, CODE_LENGTH);
    return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // The submit tap is the gesture that lets us start the AudioContext.
    unlockAudio();
    const rawCode = code.replace(/-/g, "");
    if (rawCode.length !== CODE_LENGTH) {
      setError("Enter the full 8-character access code.");
      return;
    }
    const accessCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
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
        value={code}
        onChange={(e) => {
          setCode(formatCode(e.target.value));
          setError(null);
        }}
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
