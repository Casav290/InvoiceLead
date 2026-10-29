import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

/**
 * Notes internes que le modèle écrit parfois entre balises dans son TEXTE au lieu de sa réflexion
 * (aperçu Greetlead du 29.10.2026 : une réponse à « supprime » commençait par « <reasoning>Respond in
 * French, tu.</reasoning> », affiché tel quel dans le fil). Elles ne sont ni affichées, ni gardées
 * dans l'historique renvoyé au navigateur, ni relues par le modèle à l'appel suivant du même tour.
 *
 * - un bloc fermé (<reasoning>…</reasoning>, <thinking>…</thinking>, <analysis>…</analysis>) est
 *   retiré en entier, même sur plusieurs lignes, attributs et casse compris ;
 * - une balise ouvrante sans fermeture : retirée jusqu'à la fin de sa ligne ;
 * - une balise fermante seule : retirée depuis le début de sa ligne (la note est avant elle).
 * Tout autre texte reste au caractère près (« 3 < 5 », « <br> » que le rendu de la bulle traite).
 * Seuls les messages du modèle passent ici : ce que la personne a tapé n'est jamais touché.
 */
const TAGS = "reasoning|thinking|analysis";
const CLOSED = new RegExp(`<(${TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
const ORPHAN_CLOSE = new RegExp(`^[^\\n]*?<\\/(?:${TAGS})\\s*>`, "gim");
const ORPHAN_OPEN = new RegExp(`<(?:${TAGS})\\b[^>]*>[^\\n]*`, "gi");

/** Le texte sans notes internes entre balises ; la même chaîne s'il n'en a pas. */
export function withoutReasoning(text: string): string {
  const out = text.replace(CLOSED, "").replace(ORPHAN_CLOSE, "").replace(ORPHAN_OPEN, "");
  if (out === text) return text;
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Block = BetaContentBlock | BetaContentBlockParam;
const THINKING = new Set(["thinking", "redacted_thinking"]);

/**
 * Nettoie SUR PLACE le contenu d'un message du modèle, dès que le Tool Runner le rend (run.ts) : le
 * runner garde ce même tableau dans son historique, donc l'appel suivant du tour, le texte affiché et
 * l'historique renvoyé n'en voient que la version propre. Un bloc texte vidé est retiré (le service
 * refuse un texte vide). Réflexion gardée par le service : un bloc de réflexion n'est valable que si
 * tout ce qui le précède est resté identique ; les blocs de réflexion qui SUIVENT un texte changé dans
 * ce message sont donc retirés (ceux d'avant restent valables). Rend true si le message a changé.
 */
export function stripReasoningInPlace(content: Block[]): boolean {
  let edited = false;
  let changed = false;
  for (let i = 0; i < content.length; ) {
    const block = content[i] as Block;
    if (edited && THINKING.has(block.type)) {
      content.splice(i, 1);
      changed = true;
      continue;
    }
    if (block.type === "text") {
      const clean = withoutReasoning(block.text);
      if (clean !== block.text) {
        edited = true;
        changed = true;
        if (!clean) {
          content.splice(i, 1);
          continue;
        }
        block.text = clean;
      }
    }
    i += 1;
  }
  return changed;
}

/**
 * Messages du modèle de ce tour qui ne disent plus rien (ni texte, ni appel d'outil) après le
 * nettoyage : retirés de l'historique renvoyé, sinon le service refuserait le tour suivant (message
 * vide). Les messages reçus du navigateur (`history`, tours précédents) restent tels quels.
 */
export function withoutSilentMessages(
  messages: BetaMessageParam[],
  history: BetaMessageParam[],
): BetaMessageParam[] {
  const received = new Set(history);
  return messages.filter(
    (m) =>
      received.has(m) ||
      m.role !== "assistant" ||
      typeof m.content === "string" ||
      m.content.some((b) => b.type !== "thinking" && b.type !== "redacted_thinking"),
  );
}
