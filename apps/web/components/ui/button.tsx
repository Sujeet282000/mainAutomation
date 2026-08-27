import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40",
  {
    variants: {
      variant: {
        primary: "bg-violet-600 text-white shadow-sm hover:bg-violet-700",
        secondary: "border border-line bg-elevated text-ink hover:bg-muted",
        ghost: "text-ink-muted hover:bg-muted hover:text-ink",
        danger: "bg-danger text-white hover:opacity-90",
        outline: "border border-violet-400 text-violet-600 hover:bg-muted"
      },
      size: {
        sm: "h-8 px-2.5 text-xs",
        md: "h-9 px-3.5",
        lg: "h-11 px-4"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
