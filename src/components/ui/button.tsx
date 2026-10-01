import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bouton désactivé (fonction grisée, allocation utilisée, envoi en cours) : gris, sans transparence,
 * texte #67625c sur #f2f0ee (5,3:1) ou sur fond clair (6:1), lisible ; jamais la couleur de l'action
 * pâlie.
 */
const greyed =
  "disabled:pointer-events-none disabled:border disabled:border-line-strong disabled:bg-muted disabled:text-ink-muted";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-colors",
  {
    variants: {
      variant: {
        primary: `bg-accent text-white hover:bg-accent-dark ${greyed}`,
        secondary: `border border-line-strong bg-panel text-ink hover:bg-muted ${greyed}`,
        // Bouton discret : désactivé, sur fond gris, sans cadre.
        ghost:
          "text-ink-muted hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:bg-muted disabled:text-ink-muted",
        lead: `bg-lead text-white hover:bg-lead-dark ${greyed}`,
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-[14px]",
        lg: "h-12 px-6 text-[15px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
