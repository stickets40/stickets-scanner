import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, FC } from "react";
import Spinner from "./spinner";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "lg" | "xl";
  isLoading?: boolean;
  loadingText?: string;
}

const variantClasses = {
  primary:
    "bg-brand text-white border-transparent hover:bg-brand/90 active:bg-brand/80",
  secondary:
    "bg-surface-2 text-ink border-line hover:bg-line-soft active:bg-line-soft",
  danger:
    "bg-transparent text-danger border-danger/40 hover:bg-danger/10 active:bg-danger/15",
  ghost:
    "bg-transparent text-ink-muted border-transparent hover:bg-surface-2 active:bg-surface-2",
};

/**
 * Every tier clears the 44px minimum touch target. This app is operated
 * one-handed, often with gloves, in the dark — a 36px button is a missed tap
 * and a stalled queue.
 */
const sizeClasses = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
  xl: "min-h-14 px-8 text-base",
};

const Button: FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "lg",
  isLoading = false,
  loadingText,
  className,
  disabled,
  ...props
}) => {
  return (
    <button
      className={cn(
        "flex items-center justify-center gap-2 rounded-2xl border font-semibold",
        "transition-colors duration-200",
        // Authored focus ring — the UA default is close to invisible against a
        // dark surface, and keyboard users never see :hover.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner />
          {loadingText || children}
        </>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;
