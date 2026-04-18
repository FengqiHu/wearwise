import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full rounded-lg border border-pebble bg-cream px-4 py-3 text-sm text-charcoal",
        "placeholder:text-dim focus-visible:outline-none focus-visible:shadow-focus-warm",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
