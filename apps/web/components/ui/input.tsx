import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-elevated px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-teal focus:ring-2 focus:ring-teal/20",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
