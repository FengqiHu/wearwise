import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClassMap: Record<ButtonVariant, string> = {
  primary:
    "bg-charcoal text-chalk shadow-btn-dark hover:opacity-80 active:opacity-75",
  outline:
    "bg-transparent text-charcoal border border-[rgba(28,28,28,0.4)] hover:bg-[rgba(28,28,28,0.04)] active:opacity-80",
  ghost:
    "bg-transparent text-charcoal border border-transparent hover:bg-[rgba(28,28,28,0.04)] active:opacity-80",
  danger:
    "bg-red-700 text-red-50 border border-red-700 hover:bg-red-600 active:opacity-80"
};

const sizeClassMap: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition duration-150",
          "focus-visible:outline-none focus-visible:shadow-focus-warm",
          "disabled:cursor-not-allowed disabled:opacity-50",
          variantClassMap[variant],
          sizeClassMap[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
