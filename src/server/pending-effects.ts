import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Effets qui sortent de la base (envoi des états à CRMlead) pendant une écriture de l'Assistant IA
 * jouée dans une transaction : l'essai à blanc d'une proposition (annulé ensuite) ou un lot confirmé
 * (tout ou rien). Ils ne partent pas pendant la transaction : la fonction qui les déclenche les note
 * ici, et c'est l'appelant qui les lance une fois la transaction validée, avec la base ordinaire
 * (jamais une connexion de transaction déjà rendue), ou qui les oublie après un essai à blanc.
 *
 * Hors d'une écriture de l'assistant, rien ne change : `pendingEffects()` rend null.
 */
export type PendingEffects = {
  /** Entreprises dont la file CRMlead a reçu un nouvel état à envoyer. */
  crmlead: Set<string>;
};

const store = new AsyncLocalStorage<PendingEffects>();

/** Effets à différer pour l'écriture en cours, ou null hors d'une écriture de l'assistant. */
export function pendingEffects(): PendingEffects | null {
  return store.getStore() ?? null;
}

/** Joue `fn` en notant ses effets extérieurs au lieu de les lancer ; rend le résultat et les effets. */
export async function collectEffects<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; effects: PendingEffects }> {
  const effects: PendingEffects = { crmlead: new Set() };
  const value = await store.run(effects, fn);
  return { value, effects };
}
