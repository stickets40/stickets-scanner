import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, ReactNode, FC } from "react";
import { forwardRef, useId } from "react";

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
        "flex w-full items-center gap-2.5 rounded-2xl border border-solid px-4 transition-colors",
        // 52px: comfortably past the 44px floor, and the field an operator
        // types an access code into with cold hands.
        "min-h-[3.25rem] bg-surface-2",
        "focus-within:ring-2 focus-within:ring-brand-ink/60",
        isError
          ? "border-danger focus-within:border-danger"
          : "border-line focus-within:border-brand-ink",
        isDisabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {startContent && (
        <div className="flex shrink-0 items-center gap-2 text-ink-faint">
          {startContent}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {endContent && (
        <div className="flex shrink-0 items-center">{endContent}</div>
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
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const messageId = `${inputId}-message`;

    return (
      <div className="flex w-full flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-ink-muted"
          >
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
            id={inputId}
            className={cn(
              // text-base (16px) is load-bearing: anything smaller makes iOS
              // Safari zoom the viewport on focus.
              "w-full min-w-0 border-none bg-transparent text-base text-ink",
              "placeholder:text-ink-faint focus:outline-none",
              className
            )}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || helperText ? messageId : undefined}
            {...props}
          />
        </InputContainer>

        {(error || helperText) && (
          <div
            id={messageId}
            // Errors must be announced, not just painted.
            role={error ? "alert" : undefined}
            className="flex items-center px-1"
          >
            <span
              className={cn("text-xs", error ? "text-danger" : "text-ink-muted")}
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
