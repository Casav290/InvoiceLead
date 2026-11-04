/**
 * La visite guidée des applications Lead (04.11.2026), reprise de ProjectLead (a8f0b2f, src/tour/). Le moteur
 * (`Tour.tsx`, `TourProvider.tsx`, `art.tsx`, `tour.css`) ne connaît aucune application : chaque application
 * n'apporte que son fichier d'étapes (`steps.<app>.ts`) et ses textes (`app.tour.*` dans messages/<langue>.json).
 * Dans InvoiceLead : `steps.invoicelead.ts`, les `data-tour` d'AppNav, AppSwitcher et UserMenu, le fournisseur monté
 * par components/app/AppTour.tsx dans la mise en page connectée, et le drapeau serveur `users.tour_pending`
 * (drizzle/0050_visite_guidee.sql, server/tour.ts). Voir docs/VISITE.md.
 */
import type { ArtName } from "./art";

export type TourStep = {
  /** Identifiant stable (contrôles du navigateur : `data-tour-step`). */
  id: string;
  /**
   * Les zones montrées : un ou plusieurs sélecteurs CSS. Seuls les éléments réellement visibles comptent ; plusieurs
   * éléments → la découpe les entoure tous. Sans cible : la carte se pose au centre (accueil de la visite).
   * Une zone hors de l'écran dans une barre qui défile (le menu d'InvoiceLead sur un téléphone) y est d'abord
   * amenée (`scrollIntoView`).
   */
  target?: string | string[];
  /**
   * La zone vit dans un menu latéral replié sur un écran étroit (ProjectLead) : la visite l'ouvre le temps de
   * l'étape (`onMenu(true)`), puis le referme. InvoiceLead n'a pas de menu replié : sa barre défile.
   */
  inMenu?: boolean;
  /** Clés de traduction du titre et du texte (moins de 25 mots, une idée). */
  title: string;
  body: string;
  /** La petite animation qui montre la fonction (art.tsx). */
  art?: ArtName;
  /** Un geste à essayer tout de suite : ferme la visite, puis lance `run` (ex. : ouvrir l'Assistant IA). */
  action?: { label: string; run: () => void };
};

/** Pourquoi la visite s'est fermée : passée, terminée, ou quittée par un clic sur la zone montrée. */
export type TourEnd = "skip" | "done" | "target" | "action";
