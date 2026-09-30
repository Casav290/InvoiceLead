/**
 * Formulaire de décompte TVA de l'AFC, méthode effective : chiffres du formulaire par taux.
 * Les taux avant 2024 gardent leurs anciens chiffres (302, 312, 342) pour les prestations
 * antérieures déclarées après coup.
 */
export const RATE_FIGURES: Record<number, string> = {
  810: "303",
  260: "313",
  380: "343",
  770: "302",
  250: "312",
  370: "342",
};

/** Ordre d'affichage des chiffres du formulaire. */
export const FIGURE_ORDER = [
  "200",
  "220",
  "230",
  "289",
  "299",
  "303",
  "313",
  "343",
  "302",
  "312",
  "342",
  "399",
  "400",
  "405",
  "479",
  "500",
  "510",
] as const;

/** Trimestres civils (périodes TVA usuelles) qui touchent l'intervalle donné. */
export function quartersBetween(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let year = Number(from.slice(0, 4));
  let q = Math.floor((Number(from.slice(5, 7)) - 1) / 3);
  for (;;) {
    const start = `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    if (start > to) break;
    const endMonth = q * 3 + 3;
    const end = new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10);
    out.push({ start, end });
    q += 1;
    if (q === 4) {
      q = 0;
      year += 1;
    }
  }
  return out;
}

/** Échéance de paiement AFC : 60 jours après la fin de la période. */
export function vatDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}
