import { cn } from "@/lib/utils";

/** Carré de marque d'une application Lead (« IL », « SL », « CL »), toujours accompagné de son nom. */
export function AppMark({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center bg-accent text-[11px] font-extrabold text-white",
        className,
      )}
    >
      {label}
    </span>
  );
}
