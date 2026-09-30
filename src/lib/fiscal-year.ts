/**
 * Calcul des exercices comptables sur des dates ISO (AAAA-MM-JJ), sans fuseau horaire.
 * Un exercice ordinaire dure douze mois à partir du mois de début choisi dans les réglages ;
 * le premier peut commencer n'importe quel jour (création de l'entreprise).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Date ISO réelle (refuse 2026-02-30). */
export function isIsoDate(value: string): boolean {
  return ISO.test(value) && format(parse(value)) === value;
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Premier jour d'un mois (index 0 à 11 ; 12 déborde sur l'année suivante). */
function monthStart(year: number, monthIndex: number): string {
  return format(new Date(Date.UTC(year, monthIndex, 1)));
}

/** Fin de l'exercice ordinaire qui contient `date`, pour un exercice commençant au mois `startMonth` (1 à 12). */
export function fiscalYearEndContaining(date: string, startMonth: number): string {
  const d = parse(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 à 11
  const startYear = month >= startMonth - 1 ? year : year - 1;
  return addDays(monthStart(startYear + 1, startMonth - 1), -1);
}

/** Exercice ordinaire qui contient `date`. */
export function fiscalYearContaining(date: string, startMonth: number) {
  const end = fiscalYearEndContaining(date, startMonth);
  const e = parse(end);
  const start = monthStart(e.getUTCFullYear() - 1, e.getUTCMonth() + 1);
  return { start, end };
}

/**
 * Premier exercice : de `start` à la fin de l'exercice ordinaire en cours, ou jusqu'à la fin du
 * suivant si l'entreprise prolonge un premier exercice qui commence en cours d'année.
 */
export function firstFiscalYear(start: string, startMonth: number, extended: boolean) {
  const end = fiscalYearEndContaining(start, startMonth);
  const isOrdinaryStart = fiscalYearContaining(start, startMonth).start === start;
  return {
    start,
    end: extended && !isOrdinaryStart ? nextFiscalYear(end).end : end,
    extendable: !isOrdinaryStart,
  };
}

/** Exercice qui suit celui qui finit le `previousEnd` : douze mois, sans trou. */
export function nextFiscalYear(previousEnd: string) {
  const start = addDays(previousEnd, 1);
  const s = parse(start);
  return { start, end: addDays(monthStart(s.getUTCFullYear() + 1, s.getUTCMonth()), -1) };
}

/** « 01.01.2026 » : format de date suisse, identique en allemand et en français. */
/** « 30.09.2026 » (Suisse, Allemagne), « 30/09/2026 » (France, Royaume-Uni), « 09/30/2026 » (États-Unis). */
export type DateStyle = "dot" | "slash" | "us";

export function formatDate(iso: string, style: DateStyle = "dot"): string {
  const [y, m, d] = iso.split("-");
  if (style === "us") return `${m}/${d}/${y}`;
  return style === "slash" ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
}
