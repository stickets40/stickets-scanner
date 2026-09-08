import type { FC } from "react";
import Spinner from "./spinner";

const Loading: FC = () => {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-surface-0"
      role="status"
      aria-label="Loading"
    >
      <Spinner className="h-8 w-8 text-brand-ink" />
    </div>
  );
};

export default Loading;
