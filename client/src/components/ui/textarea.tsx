import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full rounded-2xl border border-boutique-300 bg-boutique-50 px-4 py-3 text-sm text-boutique-900",
        "placeholder:text-boutique-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-boutique-400",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
