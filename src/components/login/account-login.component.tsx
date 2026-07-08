"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { User, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { loginResultSchema } from "@/types/scanner.types";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { Text } from "@/components/ui/text";

interface AccountFormData {
  username: string;
  password: string;
}

const AccountLoginComponent = () => {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<AccountFormData>();

  const onSubmit = async (data: AccountFormData) => {
    setError(null);

    try {
      const response = await api.post("auth/login", { json: data });

      if (!response.ok) {
        const err = await response.json<{ message?: string }>();
        setError(err.message || "Invalid credentials");
        return;
      }

      // BFF returns only the profile; the token is set as an httpOnly cookie.
      const { scanner } = loginResultSchema.parse(await response.json());
      login(scanner, "account");
      router.push("/scan");
    } catch {
      setError("Connection error. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        placeholder="scanner_name"
        autoCapitalize="none"
        autoCorrect="off"
        startContent={<User className="h-4 w-4 text-text-secondary" />}
        {...register("username", { required: true })}
      />
      <Input
        type="password"
        placeholder="Password"
        startContent={<Lock className="h-4 w-4 text-text-secondary" />}
        {...register("password", { required: true })}
      />

      <Text variant="p3" color="secondary">
        This account is managed by the event organizer.
      </Text>

      {error && (
        <div className="rounded-lg bg-error-light px-4 py-2.5">
          <Text variant="p2" color="danger">
            {error}
          </Text>
        </div>
      )}

      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Log in & Open Scanner
      </Button>
    </form>
  );
};

export default AccountLoginComponent;
