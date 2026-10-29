import type { ReactNode } from "react";

/**
 * Texte du modèle dans la bulle (cahier d'alignement du 28.10.2026, B6) : la consigne demande du
 * texte simple ; ce qui passe quand même est mis au propre ici, sans jamais interpréter de HTML
 * (jamais de HTML injecté dans la page : des nœuds React, que React échappe).
 * - `<br>` / `<br/>` → saut de ligne (le paragraphe est en white-space: pre-wrap) ;
 * - `#` de titre en début de ligne retiré ;
 * - tableau Markdown : lignes de séparation `|---|` retirées, cellules en ligne simple « a · b » ;
 * - clôtures de bloc de code « ``` » retirées ;
 * - `**gras**` → <strong>, un `**` seul retiré ;
 * - tout autre HTML reste du texte (« <script> » s'affiche tel quel, rien ne s'exécute) ;
 * - typographie française (espaces fines insécables) en français seulement.
 */

/** Ligne de séparation d'un tableau Markdown (« |---|:---:| », « --- | --- ») ou filet « --- ». */
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s*/;

/** Cellules d'une ligne de tableau, en ligne simple. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean)
    .join(" · ");

export function tidyReply(text: string): string {
  const lines = text.replace(/<br\s*\/?>/gi, "\n").split("\n");
  // Un tableau sans bordure (« a | b ») se reconnaît à sa ligne de séparation.
  const hasTable = lines.some((l) => l.includes("-") && TABLE_RULE.test(l) && l.includes("|"));
  return lines
    .filter((l) => !TABLE_RULE.test(l) && !FENCE.test(l))
    .map((l) => {
      const line = l.replace(HEADING, "");
      const row = /^\s*\|.*\|\s*$/.test(line) || (hasTable && line.includes("|"));
      return row ? cells(line) : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Français : guillemets et ponctuation haute collés par une espace fine insécable, comme l'interface. */
export function frenchTypography(text: string): string {
  return text
    .replace(/«\s+/g, "« ")
    .replace(/\s+»/g, " »")
    .replace(/ +([?!;:])(?=\s|$)/g, " $1");
}

const BOLD = /^\*\*[^*\n]+\*\*$/;

/** Le texte prêt à afficher : nœuds React (chaînes et <strong>), jamais de HTML interprété. */
export function replyNodes(text: string, locale: string): ReactNode[] {
  const clean = tidyReply(text);
  const typeset = locale === "fr" ? frenchTypography(clean) : clean;
  return typeset
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter((part) => part !== "")
    .map((part, i) =>
      BOLD.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part.replace(/\*\*/g, ""),
    );
}
