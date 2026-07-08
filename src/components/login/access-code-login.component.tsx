"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { loginResultSchema } from "@/types/scanner.types";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { Text } from "@/components/ui/text";

const CODE_LENGTH = 8;

const AccessCodeLoginComponent = () => {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatCode = (raw: string): string => {
    const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, CODE_LENGTH);
    if (clean.length > 4) {
      return clean.slice(0, 4) + "-" + clean.slice(4);
    }
    return clean;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCode(formatCode(raw));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawCode = code.replace(/-/g, "");
    if (rawCode.length !== CODE_LENGTH) {
      setError("Please enter the full 8-character access code");
      return;
    }

    const accessCode = rawCode.slice(0, 4) + "-" + rawCode.slice(4);
    setIsSubmitting(true);

    try {
      const response = await api.post("auth/access-code", {
        json: { accessCode },
      });

      if (!response.ok) {
        const err = await response.json<{ message?: string }>();
        setError(err.message || "Invalid access code");
        setIsSubmitting(false);
        return;
      }

      // BFF returns only the profile; the token is an httpOnly cookie and the
      // reusable access code is never persisted client-side.
      const { scanner } = loginResultSchema.parse(await response.json());
      login(scanner, "access_code");
      router.push("/scan");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        placeholder="XXXX-XXXX"
        value={code}
        onChange={handleChange}
        autoCapitalize="characters"
        autoCorrect="off"
        startContent={<KeyRound className="h-4 w-4 text-primary" />}
      />

      <Text variant="p3" color="secondary">
        Access codes are event specific and may expire.
      </Text>

      {error && (
        <div className="rounded-lg bg-error-light px-4 py-2.5">
          <Text variant="p2" color="danger">
            {error}
          </Text>
        </div>
      )}

      <Button
        type="submit"
        isLoading={isSubmitting}
        className="w-full"
      >
        Enter Scanner
      </Button>
    </form>
  );
};

export default AccessCodeLoginComponent;
