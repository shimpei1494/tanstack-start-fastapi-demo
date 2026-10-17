import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700",
  {
    variants: {
      variant: {
        default: "bg-teal-800 text-white hover:bg-teal-900 px-4 py-2.5",
        outline: "border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 px-3 py-2",
        ghost: "text-stone-600 hover:bg-stone-100 px-2 py-2",
        danger: "text-red-700 hover:bg-red-50 px-2 py-2",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  ...props
}: ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>) {
  return <BaseButton className={cn(buttonVariants({ variant }), className)} {...props} />;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error instanceof Error ? error.message : "処理に失敗しました。もう一度お試しください。"}
    </p>
  ) : null;
}
