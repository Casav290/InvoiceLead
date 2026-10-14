"use client";

import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";
import { AppMark } from "@/components/brand/AppMark";
import type { LeadAppItem } from "@/lib/lead-apps";
import { cn } from "@/lib/utils";

/**
 * Lanceur à 9 points de la famille Lead, au même aspect dans toutes les applications : les six
 * applications de la liste commune (lead-apps.ts), dans le même ordre, chacune en lien simple vers son
 * adresse d'entrée, qui ouvre directement l'espace de l'entreprise. L'application courante reste à sa
 * place, sans lien, sur le fond pâle de sa couleur (« Vous êtes ici »).
 *
 * Le panneau se ferme par Échap (le focus revient au bouton), par un clic en dehors ou par un choix
 * (focus rendu au bouton aussi). Les pastilles sont décoratives (aria-hidden, AppMark) : le nom les suit ;
 * blanc sur la couleur de chaque application, contraste de 4,5:1 au moins (#9a6a00 de ProjectLead :
 * 4,73:1). Sous 480 px, il est fixe, à 16 px des bords, sous l'en-tête, et défile à l'intérieur.
 */
export function AppSwitcher({
  items,
  texts,
}: {
  items: LeadAppItem[];
  texts: { title: string; open: string; here: string };
}) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(60);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useId();

  // Bord bas de l'en-tête : le panneau du téléphone s'ouvre juste en dessous.
  const place = useCallback(() => {
    const header = button.current?.closest("header") ?? button.current;
    if (header) setTop(Math.round(header.getBoundingClientRect().bottom + 8));
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Clic en dehors, ou le clavier qui quitte le panneau (Tab après la dernière application).
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open, place]);

  return (
    <div ref={root} className="relative flex">
      <button
        ref={button}
        type="button"
        data-lead-launcher=""
        data-testid="application-switcher"
        aria-label={texts.title}
        title={texts.title}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center border border-line-strong bg-panel text-ink-3 hover:bg-muted",
          open && "bg-muted text-ink",
        )}
      >
        <span className="grid grid-cols-3 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="h-1 w-1 bg-current" />
          ))}
        </span>
      </button>
      <nav
        id={panel}
        hidden={!open}
        aria-label={texts.title}
        data-lead-launcher-panel=""
        style={{ "--lead-launcher-top": `${top}px` } as CSSProperties}
        className={cn(
          "absolute top-[calc(100%+6px)] right-0 z-50 w-[320px] border border-line-strong bg-panel p-2 font-sans text-ink",
          "max-[480px]:fixed max-[480px]:inset-x-4 max-[480px]:top-(--lead-launcher-top) max-[480px]:w-auto max-[480px]:max-h-[calc(100dvh-var(--lead-launcher-top)-16px)] max-[480px]:overflow-y-auto",
        )}
      >
        <p className="px-2 pt-1 pb-2 text-[11px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
          {texts.title}
        </p>
        <ul>
          {items.map((item) => {
            const row = "flex min-h-12 items-center gap-3 px-2 py-2";
            const body = (
              <>
                <AppMark label={item.mark} color={item.color} className="h-8 w-8 text-[12px]" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] leading-tight font-bold text-ink">{item.name}</span>
                  <span className="truncate text-[12px] leading-tight text-ink-muted">
                    {item.action}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-ink-3">
                  {item.current ? (
                    texts.here
                  ) : (
                    <>
                      {texts.open} <span aria-hidden="true">→</span>
                    </>
                  )}
                </span>
              </>
            );
            return (
              <li key={item.code}>
                {item.href ? (
                  <a
                    href={item.href}
                    data-lead-app={item.code}
                    data-testid={`application-switcher-${item.code}`}
                    onClick={() => {
                      // Choix fait : le panneau se ferme et le focus revient au bouton (la page suivante
                      // peut tarder, ou s'ouvrir dans un autre onglet avec Ctrl/Cmd).
                      setOpen(false);
                      button.current?.focus();
                    }}
                    className={cn(
                      row,
                      "hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                    )}
                  >
                    {body}
                  </a>
                ) : (
                  <div
                    data-lead-app={item.code}
                    data-testid={`application-switcher-${item.code}`}
                    aria-current="page"
                    className={row}
                    // Fond pâle de sa couleur : un dixième d'opacité, sans dégradé.
                    style={{ backgroundColor: `${item.color}1a` }}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
