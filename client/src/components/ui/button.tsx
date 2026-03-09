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
    "bg-boutique-800 text-boutique-50 border border-boutique-800 hover:bg-boutique-700 focus-visible:ring-boutique-400",
  outline:
    "bg-transparent text-boutique-900 border border-boutique-300 hover:bg-boutique-100 focus-visible:ring-boutique-400",
  ghost: "bg-transparent text-boutique-700 border border-transparent hover:bg-boutique-100 focus-visible:ring-boutique-400",
  danger: "bg-red-700 text-red-50 border border-red-700 hover:bg-red-600 focus-visible:ring-red-300"
};

const sizeClassMap: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm md:text-base",
  lg: "h-12 px-6 text-base"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-55",
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
