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

/** Méthode TDFN : premier et second taux de la dette fiscale nette (321/331 avant 2024). */
export function netRateFigure(periodEnd: string, second = false): string {
  if (periodEnd < "2024-01-01") return second ? "331" : "321";
  return second ? "332" : "322";
}

/** Chiffres qui portent une base et un impôt (l'impôt est gardé sous « 303t », « 322t », etc.). */
export const TAXED_FIGURES = ["303", "313", "343", "302", "312", "342", "322", "332", "321", "331"];

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
  "322",
  "332",
  "321",
  "331",
  "399",
  "400",
  "405",
  "479",
  "500",
  "510",
] as const;

/**
 * Périodes TVA civiles qui touchent l'intervalle : trimestres (méthode effective) ou semestres
 * (méthode TDFN).
 */
export function periodsBetween(
  from: string,
  to: string,
  months: 3 | 6 = 3,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const perYear = 12 / months;
  let year = Number(from.slice(0, 4));
  let p = Math.floor((Number(from.slice(5, 7)) - 1) / months);
  for (;;) {
    const start = `${year}-${String(p * months + 1).padStart(2, "0")}-01`;
    if (start > to) break;
    const end = new Date(Date.UTC(year, p * months + months, 0)).toISOString().slice(0, 10);
    out.push({ start, end });
    p += 1;
    if (p === perYear) {
      p = 0;
      year += 1;
    }
  }
  return out;
}

export const quartersBetween = (from: string, to: string) => periodsBetween(from, to, 3);

/** Échéance de paiement AFC : 60 jours après la fin de la période. */
export function vatDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}
