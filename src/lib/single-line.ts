/**
 * Texte d'une seule ligne (nom d'une personne) : aucun caractère de contrôle (retour à la ligne,
 * tabulation, caractère nul…) ni séparateur de ligne ou de paragraphe Unicode (Zl, Zp). Un nom envoyé
 * au Compte Lead finit dans un email (« Bonjour <nom>, ») : sur plusieurs lignes, il y ouvrirait un
 * paragraphe à lui, qu'un lien seul sur sa ligne transformerait en bouton.
 */
const SINGLE_LINE = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;

export function isSingleLine(value: string): boolean {
  return SINGLE_LINE.test(value);
}
