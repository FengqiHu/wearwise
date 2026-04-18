import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { ButtonHTMLAttributes, FormEvent, HTMLAttributes, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface PromptInputProps extends Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> {
  value: string;
  onSubmit: () => void;
  isLoading?: boolean;
  children: ReactNode;
}

interface PromptInputTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  isLoading?: boolean;
  maxHeight?: number;
}

interface PromptInputActionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

interface PromptSuggestionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

function resizeTextarea(textarea: HTMLTextAreaElement, maxHeight: number): void {
  textarea.style.height = "0px";
  const nextHeight = Math.min(maxHeight, textarea.scrollHeight);
  textarea.style.height = `${Math.max(nextHeight, 44)}px`;
}

export const PromptInput = forwardRef<HTMLFormElement, PromptInputProps>(
  ({ className, value, onSubmit, isLoading = false, children, ...props }, ref) => {
    const canSubmit = useMemo(() => value.trim().length > 0 && !isLoading, [value, isLoading]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!canSubmit) return;
      onSubmit();
    };

    return (
      <form
        ref={ref}
        onSubmit={handleSubmit}
        className={cn("rounded-xl border border-pebble bg-cream p-2", className)}
        {...props}
      >
        {children}
      </form>
    );
  }
);

PromptInput.displayName = "PromptInput";

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  ({ className, value, onValueChange, isLoading = false, maxHeight = 220, onKeyDown, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
      if (!innerRef.current) return;
      resizeTextarea(innerRef.current, maxHeight);
    }, [value, maxHeight]);

    const setRefs = (element: HTMLTextAreaElement | null): void => {
      innerRef.current = element;
      if (typeof ref === "function") {
        ref(element);
        return;
      }
      if (ref) ref.current = element;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const form = event.currentTarget.form;
        if (form) form.requestSubmit();
        return;
      }
      onKeyDown?.(event);
    };

    return (
      <textarea
        ref={setRefs}
        rows={1}
        value={value}
        disabled={isLoading}
        onChange={(event) => { onValueChange(event.target.value); }}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full resize-none bg-transparent px-3 py-2 text-sm text-charcoal outline-none",
          "placeholder:text-dim",
          className
        )}
        {...props}
      />
    );
  }
);

PromptInputTextarea.displayName = "PromptInputTextarea";

export const PromptInputActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("flex items-center justify-end gap-2 px-1", className)} {...props} />;
});

PromptInputActions.displayName = "PromptInputActions";

export const PromptInputAction = forwardRef<HTMLDivElement, PromptInputActionProps>(({ className, children, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("inline-flex items-center", className)} {...props}>
      {children}
    </div>
  );
});

PromptInputAction.displayName = "PromptInputAction";

export const PromptSuggestions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("flex flex-wrap gap-2", className)} {...props} />;
});

PromptSuggestions.displayName = "PromptSuggestions";

export const PromptSuggestion = forwardRef<HTMLButtonElement, PromptSuggestionProps>(
  ({ className, children, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "rounded-full border border-pebble bg-cream px-3 py-1.5 text-xs text-dim transition",
          "hover:bg-[rgba(28,28,28,0.05)] hover:text-charcoal",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

PromptSuggestion.displayName = "PromptSuggestion";
