import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, ReactNode, FC } from "react";
import { forwardRef } from "react";

// ─── InputContainer ──────────────────────────────────────────

interface InputContainerProps {
  children: ReactNode;
  startContent?: ReactNode;
  endContent?: ReactNode;
  isError?: boolean;
  isDisabled?: boolean;
  className?: string;
}

export const InputContainer: FC<InputContainerProps> = ({
  children,
  startContent,
  endContent,
  isError,
  isDisabled,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex gap-2.5 items-center h-11 px-4 w-full bg-white rounded-2xl border border-solid shadow-sm transition-colors",
        "focus-within:border-primary",
        isError
          ? "border-danger focus-within:border-danger"
          : "border-border",
        isDisabled && "bg-gray-100 opacity-60 cursor-not-allowed",
        className
      )}
    >
      {startContent && (
        <div className="text-base text-text-secondary shrink-0 flex items-center gap-2">
          {startContent}
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
      {endContent && (
        <div className="shrink-0 flex items-center">{endContent}</div>
      )}
    </div>
  );
};

// ─── Input ───────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  startContent?: ReactNode;
  endContent?: ReactNode;
  containerClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      startContent,
      endContent,
      className,
      containerClassName,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <div className="flex flex-col gap-1 w-full">
        {label && (
          <label className="text-sm font-medium text-text-primary">
            {label}
          </label>
        )}

        <InputContainer
          startContent={startContent}
          endContent={endContent}
          isError={!!error}
          isDisabled={disabled}
          className={containerClassName}
        >
          <input
            ref={ref}
            className={cn(
              "w-full border-none bg-transparent text-base text-text-primary placeholder:text-text-secondary/50 focus:outline-none min-w-0",
              className
            )}
            disabled={disabled}
            {...props}
          />
        </InputContainer>

        {(error || helperText) && (
          <div className="flex items-center px-2">
            <span
              className={cn(
                "text-xs",
                error ? "text-danger" : "text-text-secondary"
              )}
            >
              {error || helperText}
            </span>
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
