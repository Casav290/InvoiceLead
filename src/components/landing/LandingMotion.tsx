"use client";

import { useEffect } from "react";

/**
 * Apparitions au défilement et compteurs de la page d'accueil, posés après coup : le HTML du serveur
 * est complet et visible (sans JavaScript, rien ne reste caché). Seuls les éléments encore sous la
 * ligne de flottaison sont mis en attente, puis montrés à leur arrivée à l'écran.
 *
 * - `data-reveal` : l'élément monte et apparaît ; `data-reveal-delay` en millisecondes.
 * - `data-cells` : une grille dont chaque cellule trace son trait prune, l'une après l'autre.
 * - `data-count` : un nombre qui compte jusqu'à sa valeur.
 * - `data-ticket` : le ticket lu par l'IA s'anime seulement quand il est à l'écran.
 */
export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = (el: Element) => el.getBoundingClientRect().top > window.innerHeight * 0.92;

    const reveals = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
      below,
    );
    for (const el of reveals) {
      el.style.setProperty("--stagger", `${Number(el.dataset.revealDelay ?? 0)}ms`);
      el.classList.add("lp-wait");
    }

    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-cells]"));
    for (const grid of cells) {
      grid.classList.add("lp-cells");
      Array.from(grid.children).forEach((child, i) => {
        (child as HTMLElement).style.setProperty("--i", String(i));
      });
      if (!below(grid)) grid.classList.add("lp-drawn");
    }

    const counts = Array.from(document.querySelectorAll<HTMLElement>("[data-count]")).filter(below);
    for (const el of counts) el.textContent = "0";

    const frames: number[] = [];
    const countUp = (el: HTMLElement) => {
      const target = Number(el.dataset.count);
      const start = performance.now();
      const duration = 1100;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        el.textContent = String(Math.round(target * (1 - (1 - p) ** 3)));
        if (p < 1) frames.push(requestAnimationFrame(tick));
      };
      frames.push(requestAnimationFrame(tick));
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          io.unobserve(el);
          if (el.classList.contains("lp-wait")) {
            el.classList.remove("lp-wait");
            el.classList.add("lp-shown");
          }
          if (el.dataset.cells !== undefined) el.classList.add("lp-drawn");
          if (el.dataset.count !== undefined) countUp(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of [...reveals, ...cells, ...counts]) io.observe(el);

    // Le ticket ne s'anime qu'à l'écran.
    const tickets = Array.from(document.querySelectorAll<HTMLElement>("[data-ticket]"));
    const live = new IntersectionObserver((entries) => {
      for (const entry of entries)
        (entry.target as HTMLElement).dataset.live = String(entry.isIntersecting);
    });
    for (const el of tickets) live.observe(el);

    return () => {
      io.disconnect();
      live.disconnect();
      for (const f of frames) cancelAnimationFrame(f);
    };
  }, []);
  return null;
}
