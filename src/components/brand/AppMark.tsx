import { cn } from "@/lib/utils";

/**
 * Carré de marque d'une application Lead (« IL », « SL », « CL »), toujours accompagné de son nom.
 * `color` : la couleur de l'application (liste de la famille, lead-apps.ts) ; sans elle, celle
 * d'InvoiceLead.
 */
export function AppMark({
  label,
  className,
  color,
}: {
  label: string;
  className?: string;
  color?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center bg-accent text-[11px] font-extrabold text-white",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {label}
    </span>
  );
}
