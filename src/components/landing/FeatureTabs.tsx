"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type FeatureTab = {
  key: string;
  label: string;
  title: string;
  points: string[];
  pro: string | null;
  /** Capture déjà rendue (cadre et image) par la page, côté serveur. */
  shot: ReactNode;
};

/** Durée d'un onglet avant le suivant, tant que personne n'a choisi. */
const TAB_MS = 7000;

/**
 * Onglets des fonctions : une rangée de cellules, la capture de l'écran en dessous. Ils avancent
 * seuls (barre de progression sous l'onglet actif) tant que personne n'a cliqué, et s'arrêtent au
 * survol, hors de l'écran et avec prefers-reduced-motion. Tous les panneaux sont rendus côté
 * serveur, empilés, pour que le texte reste lisible sans JavaScript et par les moteurs de recherche.
 */
export function FeatureTabs({ tabs, label }: { tabs: FeatureTab[]; label: string }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  // Lien direct vers un onglet (« #tab-bills », depuis la nouveauté du héros) : il s'ouvre, sans avancer seul.
  useEffect(() => {
    const open = () => {
      const key = window.location.hash.replace(/^#tab-/, "");
      const index = tabs.findIndex((tab) => tab.key === key);
      if (index < 0) return false;
      setAuto(false);
      setActive(index);
      return true;
    };
    const opened = open();
    if (!opened && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAuto(true);
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [tabs]);

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), {
      threshold: 0.35,
    });
    if (root.current) io.observe(root.current);
    return () => io.disconnect();
  }, []);

  // L'onglet actif reste visible dans la rangée qui défile (téléphone), sans faire défiler la page.
  useEffect(() => {
    const button = buttons.current[active];
    const strip = button?.parentElement;
    if (!button || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const left = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: auto ? "smooth" : "auto" });
  }, [active, auto]);

  const choose = (index: number, focus = false) => {
    setAuto(false);
    setActive(index);
    if (focus) buttons.current[index]?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? active === last
          ? 0
          : active + 1
        : event.key === "ArrowLeft"
          ? active === 0
            ? last
            : active - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  };

  return (
    <div
      ref={root}
      className="lp-tabs relative"
      data-auto={auto}
      data-paused={hovered || !visible}
      style={{ "--tab-ms": `${TAB_MS}ms` } as React.CSSProperties}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {tabs.map((tab) => (
        <span
          key={tab.key}
          id={`tab-${tab.key}`}
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 left-0"
        />
      ))}
      <div
        role="tablist"
        aria-label={label}
        className="flex overflow-x-auto border border-line-strong bg-panel [scrollbar-width:none] lg:grid lg:grid-cols-8 lg:overflow-visible"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => choose(i)}
            onKeyDown={onKey}
            className={cn(
              "lp-tab relative flex min-h-[52px] shrink-0 items-center justify-center border-r border-line px-4 text-[13px] font-semibold whitespace-nowrap last:border-r-0 lg:px-2",
              i === active
                ? "bg-accent-veil font-extrabold text-accent-dark"
                : "text-ink-3 hover:bg-muted hover:text-ink",
            )}
          >
            {tab.label}
            <span
              aria-hidden="true"
              className="lp-tab-bar absolute inset-x-0 bottom-0 h-[3px] bg-accent"
              onAnimationEnd={() => setActive((a) => (a + 1) % tabs.length)}
            />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 border border-t-0 border-line-strong bg-panel">
        {tabs.map((tab, i) => (
          <div
            key={tab.key}
            role="tabpanel"
            id={`${id}-panel-${tab.key}`}
            aria-labelledby={`${id}-tab-${tab.key}`}
            data-active={i === active}
            inert={i !== active}
            className="lp-panel grid grid-cols-1 content-start gap-6 p-4 sm:p-8"
          >
            <div className="lp-panel-text grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
              <div className="flex flex-col items-start gap-3">
                {tab.pro ? (
                  <span className="border-l-[3px] border-accent bg-accent-pale px-2 py-[3px] text-[10.5px] font-extrabold tracking-[0.05em] text-accent-dark uppercase">
                    {tab.pro}
                  </span>
                ) : null}
                <h3 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-ink sm:text-[28px]">
                  {tab.title}
                </h3>
              </div>
              <ul className="grid content-start gap-2.5 text-[15px] text-ink-2 md:pt-1">
                {tab.points.map((point) => (
                  <li key={point} className="relative pl-5">
                    <span
                      aria-hidden="true"
                      className="absolute top-[0.62em] left-0 h-[2px] w-2.5 bg-accent"
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-panel-shot min-w-0">{tab.shot}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
