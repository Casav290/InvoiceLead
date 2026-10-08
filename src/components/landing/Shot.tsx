import { AppMark } from "@/components/brand/AppMark";
import { cn } from "@/lib/utils";
import shots from "./shots.json";

type ShotInfo = { w: number; h: number; widths: number[] };
const SHOTS = shots as Record<string, ShotInfo>;

/**
 * Capture d'écran de l'application (données d'exemple d'une entreprise fictive), en AVIF et WebP
 * à plusieurs largeurs : public/landing/<langue>/<nom>-<largeur>.<format>, produites par
 * scripts/landing-images.mjs avec leurs dimensions dans shots.json.
 */
export function Shot({
  locale,
  name,
  alt,
  sizes,
  className,
  imgClassName,
  priority = false,
}: {
  locale: string;
  name: string;
  alt: string;
  sizes: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  const info = SHOTS[`${locale}/${name}`] ?? SHOTS[`en/${name}`];
  if (!info) return null;
  const base = `/landing/${SHOTS[`${locale}/${name}`] ? locale : "en"}/${name}`;
  const set = (ext: string) => info.widths.map((w) => `${base}-${w}.${ext} ${w}w`).join(", ");
  const largest = info.widths[info.widths.length - 1];
  return (
    <picture className={cn("block", className)}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <img
        src={`${base}-${largest}.webp`}
        srcSet={set("webp")}
        sizes={sizes}
        width={info.w}
        height={info.h}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        className={cn("block h-auto w-full", imgClassName)}
      />
    </picture>
  );
}

/**
 * Cadre d'écran « Trait net » : une rangée de cellules (repères, adresse, marque) au-dessus de la
 * capture. Pas de coins arrondis, pas d'ombre : un trait.
 */
export function Frame({
  url,
  children,
  className,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-line-strong bg-panel", className)}>
      <div className="flex h-9 items-stretch border-b border-line-strong bg-head">
        <span aria-hidden="true" className="flex items-center gap-1.5 border-r border-line px-3">
          <span className="h-2 w-2 border border-ink-3" />
          <span className="h-2 w-2 border border-ink-3" />
          <span className="h-2 w-2 bg-accent" />
        </span>
        <span className="flex min-w-0 flex-1 items-center truncate px-3 text-[12px] font-semibold text-ink-muted">
          {url}
        </span>
        <span aria-hidden="true" className="flex items-center border-l border-line px-2">
          <AppMark label="IL" className="h-5 w-5 text-[9px]" />
        </span>
      </div>
      {children}
    </div>
  );
}

/** Téléphone dessiné au trait : un cadre noir à angles vifs, la capture mobile à l'intérieur. */
export function Phone({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border-[7px] border-ink bg-ink", className)}>
      <div className="flex h-5 items-center justify-center bg-ink" aria-hidden="true">
        <span className="h-[5px] w-14 bg-ink-3" />
      </div>
      <div className="bg-panel">{children}</div>
      <div className="h-4 bg-ink" aria-hidden="true" />
    </div>
  );
}
