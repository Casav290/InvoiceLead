/**
 * Même origine exigée pour les routes de la bulle (B13) : une page d'un autre site ne peut ni
 * confirmer une écriture ni envoyer un message au nom de la session. Le navigateur envoie l'en-tête
 * Origin avec chaque POST ; sans lui, Sec-Fetch-Site doit dire « same-origin ». Un client sans l'un
 * ni l'autre (script, autre serveur) est refusé.
 */
export function sameOrigin(request: Request, appUrl?: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = [new URL(request.url).origin];
    if (appUrl) {
      try {
        allowed.push(new URL(appUrl).origin);
      } catch {
        // APP_URL illisible : seule l'origine de la requête compte.
      }
    }
    return allowed.includes(origin);
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}
