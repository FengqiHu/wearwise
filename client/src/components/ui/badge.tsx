import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "solid" | "soft";
}

export function Badge({ className, variant = "soft", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide",
        variant === "solid" ? "bg-boutique-800 text-boutique-50" : "bg-boutique-100 text-boutique-800",
        className
      )}
      {...props}
    />
  );
}
