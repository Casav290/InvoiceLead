/**
 * État d'une carte « À confirmer » après un refus de /api/assistant/confirm (cahier d'alignement du
 * 28.10.2026, B7) : chaque cause a son texte traduit (messages app.aiBubble.confirm.*).
 * - session : la session a expiré (401) ;
 * - used : la proposition a déjà été utilisée (deux clics, autre onglet) ;
 * - expired : proposition expirée (10 minutes) ou illisible ;
 * - forbidden : le rôle ne le permet plus (ou une demande venue d'un autre site) ;
 * - gone : l'élément à modifier n'existe plus ;
 * - planLimit : la formule ne le permet pas ou sa limite est atteinte ;
 * - stale : les données ont changé depuis la proposition, la carte ne montre plus ce qui serait
 *   écrit (409) : rien n'est écrit ;
 * - failed : autre refus.
 * Une coupure du réseau pendant « Confirmer » donne l'état « network » (la carte reste à confirmer).
 */
export type ConfirmFailure =
  | "session"
  | "used"
  | "expired"
  | "forbidden"
  | "gone"
  | "planLimit"
  | "stale"
  | "failed";

export function failureState(status: number, error: string | undefined): ConfirmFailure {
  if (status === 401) return "session";
  if (status === 409 || error === "stale") return "stale";
  if (status === 403) {
    if (error === "token_used") return "used";
    if (error === "forbidden_role" || error === "cross_origin") return "forbidden";
    return "expired";
  }
  if (error && /not_?found/i.test(error)) return "gone";
  if (error && /(^|[\s:(])plan|plan_limit/.test(error)) return "planLimit";
  return "failed";
}
