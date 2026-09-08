import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// ─── BasePill ────────────────────────────────────────────────

interface BasePillProps {
  children: ReactNode;
  className?: string;
  size?: "xs" | "sm" | "md";
}

const sizeClasses = {
  xs: "px-2 py-0.5 text-[0.6875rem]",
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function BasePill({
  children,
  className = "",
  size = "sm",
}: BasePillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold",
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── TagPill ─────────────────────────────────────────────────

/**
 * Variants map 1:1 onto the verdict tokens in globals.css. They deliberately
 * do NOT carry their own colour values — the previous version hardcoded a
 * separate Material palette, so a pill and the icon beside it could render two
 * different greens for the same state, and `wrong_scanner` rendered a red pill
 * inside an orange card.
 */
type TagVariant = "admit" | "used" | "wrong-gate" | "invalid" | "pending";

interface TagPillProps {
  tag: string;
  variant?: TagVariant;
  size?: "xs" | "sm" | "md";
  showDot?: boolean;
  className?: string;
}

const variantClasses: Record<TagVariant, string> = {
  admit: "bg-admit/15 text-admit",
  used: "bg-used/15 text-used",
  "wrong-gate": "bg-wrong-gate/20 text-wrong-gate",
  invalid: "bg-invalid/20 text-invalid",
  pending: "bg-surface-2 text-ink-muted",
};

const dotClasses: Record<TagVariant, string> = {
  admit: "bg-admit",
  used: "bg-used",
  "wrong-gate": "bg-wrong-gate",
  invalid: "bg-invalid",
  pending: "bg-ink-faint",
};

export function TagPill({
  tag,
  variant = "pending",
  size = "sm",
  showDot = false,
  className = "",
}: TagPillProps) {
  return (
    <BasePill size={size} className={cn(variantClasses[variant], className)}>
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClasses[variant])}
          aria-hidden="true"
        />
      )}
      <span>{tag}</span>
    </BasePill>
  );
}
