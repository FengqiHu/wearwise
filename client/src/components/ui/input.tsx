import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-lg border border-pebble bg-cream px-4 text-sm text-charcoal",
      "placeholder:text-dim focus-visible:outline-none focus-visible:shadow-focus-warm",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
