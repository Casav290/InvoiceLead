import { env } from "./env";

/**
 * Cours de référence de la BCE (service Frankfurter, gratuit, sans clé), pour convertir une pièce en
 * devise. Le cours du jour ouvrable précédent est rendu pour un week-end ou un jour férié. Rien ne
 * bloque si le service ne répond pas : l'appelant demande alors le cours à l'utilisateur.
 */
export async function fetchFxRate(
  from: string,
  to: string,
  date: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  if (from === to) return 1;
  try {
    const url = `${env().FX_API_URL.replace(/\/+$/, "")}/${date}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const res = await fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, unknown> };
    const rate = Number(body.rates?.[to]);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
