import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-2xl border border-boutique-300 bg-boutique-50 px-4 text-sm text-boutique-900",
      "placeholder:text-boutique-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-boutique-400",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
