"use client";

import { useEffect } from "react";
import { Text } from "@/components/ui/text";
import Button from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-8 text-center">
      <Text variant="h5">Something went wrong</Text>
      <Text variant="p2" color="secondary">
        The scanner hit an unexpected error. Try again — your session is still
        active.
      </Text>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
