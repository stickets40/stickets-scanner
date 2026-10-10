"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Lock, User } from "lucide-react";
import { api, describeFailure } from "@/lib/api";
import { getDeviceId } from "@/lib/device-id";
import { requestPersistentStorage } from "@/lib/idb";
import { precacheShell } from "@/lib/sw-registration";
import { sessionRestored } from "@/lib/runtime";
import { useAuthStore } from "@/stores/auth.store";
import { forgetLoginHandoff } from "@/lib/login-handoff";
import { loginResultSchema } from "@/types/scanner.types";
import { unlockAudio } from "@/lib/feedback";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { Text } from "@/components/ui/text";

interface AccountFormData {
  username: string;
  password: string;
}

interface Props {
  onSuccess?: () => void;
  compact?: boolean;
  /** A username from the organizer's hand-off link (#username=…). */
  initialUsername?: string;
}

const AccountLoginComponent = ({ onSuccess, compact, initialUsername }: Props) => {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { isSubmitting },
  } = useForm<AccountFormData>({
    defaultValues: { username: initialUsername ?? "", password: "" },
  });

  // Prefilled by the hand-off link: the password is all that is left to type.
  useEffect(() => {
    if (initialUsername) setFocus("password");
  }, [initialUsername, setFocus]);

  const onSubmit = async (data: AccountFormData) => {
    setError(null);
    unlockAudio();
    const r = await api.post("auth/login", { ...data, deviceId: getDeviceId() }, { timeoutMs: 10_000, untracked: true });
    if (!r.ok) {
      setError(describeFailure(r, "Those details weren't accepted."));
      return;
    }
    const parsed = loginResultSchema.safeParse(r.data);
    if (!parsed.success) {
      setError("Unexpected answer from the server. Try again.");
      return;
    }
    login(parsed.data.scanner, "account");
    forgetLoginHandoff();
    void requestPersistentStorage();
    precacheShell();
    sessionRestored();
    if (onSuccess) onSuccess();
    else router.push("/scan");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Username"
        placeholder="scanner_name"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
        enterKeyHint="next"
        startContent={<User className="h-4 w-4" aria-hidden="true" />}
        {...register("username", { required: true })}
      />
      <Input
        label="Password"
        type="password"
        placeholder="••••••••"
        autoComplete="current-password"
        enterKeyHint="go"
        error={error ?? undefined}
        startContent={<Lock className="h-4 w-4" aria-hidden="true" />}
        {...register("password", { required: true })}
      />
      {!compact && (
        <Text variant="p3" color="muted">
          This account is managed by the event organiser.
        </Text>
      )}
      <Button type="submit" size={compact ? "lg" : "xl"} isLoading={isSubmitting} className="w-full">
        {compact ? "Sign in" : "Open scanner"}
      </Button>
    </form>
  );
};

export default AccountLoginComponent;
