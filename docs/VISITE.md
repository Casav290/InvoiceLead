# Visite guidée (04.11.2026)

Reprise fidèle de la visite de ProjectLead (commit a8f0b2f, modèle validé) dans InvoiceLead.

- Moteur commun aux applications Lead : `src/tour/` (`Tour.tsx`, `TourProvider.tsx`, `art.tsx`, `tour.css`,
  `types.ts`), composants client. Étapes d'InvoiceLead : `src/tour/steps.invoicelead.ts` (11 étapes : accueil,
  tableau de bord, devis, factures, temps et frais, contacts et articles, comptabilité, réglages, applications Lead,
  Assistant IA si la bulle est branchée, « Revoir la visite »). Textes : `app.tour.*` dans `messages/<langue>.json`,
  variantes de pays par suffixe (`titleIntl`…, `src/i18n/country.ts`).
- Montage : `src/components/app/AppTour.tsx` dans `src/app/[locale]/app/layout.tsx`. Zones : `data-tour` d'AppNav
  (`nav:<href>`), d'AppSwitcher (`apps`) et d'UserMenu (`profile`), bulle `data-testid="assistant-bubble"`.
- Une seule fois, au premier passage : `users.tour_pending` (drizzle/0050_visite_guidee.sql : colonne née FAUX pour
  les personnes d'avant, puis défaut VRAI), remis à faux par `markTourSeenAction` (`src/server/tour.ts`) dès
  l'ouverture ; le navigateur s'en souvient aussi (localStorage `lead.tour.seen.<personne>`).
- « Revoir la visite » : menu de la personne (`data-tour-replay`), n'écrit rien. « Passer » à chaque étape, Échap,
  flèches, clic sur la zone montrée (ferme et ouvre la page), « L'essayer » ouvre la bulle de l'Assistant IA.
- Téléphone : la barre du menu défile en largeur ; la visite y amène la rubrique (`scrollIntoView`), carte en bas
  (en haut quand la zone est en bas). Carte claire ou sombre selon l'appareil ; prefers-reduced-motion : rien ne bouge.
- Contrôles : `tests/unit/visite.test.ts`, `scripts/e2e-visite.mjs` (navigateur sans tête), portes
  `node scripts/visite-gates.mjs g1` … `g9`, aperçu `node scripts/visite-apercu.mjs deploy`.
