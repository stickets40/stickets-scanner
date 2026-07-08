import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, FC } from "react";
import Spinner from "./spinner";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  loadingText?: string;
}

const variantClasses = {
  primary:
    "text-white bg-primary hover:bg-primary/90 active:bg-primary/80 border-transparent",
  secondary:
    "bg-background-light text-text-primary hover:bg-border active:bg-border border-border",
  danger:
    "text-white bg-danger hover:bg-red-700 border-transparent",
  ghost:
    "bg-transparent text-text-secondary hover:bg-background-light border-transparent",
};

const sizeClasses = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
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
        "flex items-center justify-center gap-2 rounded-2xl border font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
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
