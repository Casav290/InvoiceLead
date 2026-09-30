import { readFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";

export const LEGAL_DOCS = ["imprint", "privacy", "terms", "dpa"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

/** Texte légal rédigé en Markdown (content/legal/<doc>-<langue>.md), rendu au build. Contenu interne uniquement. */
export function legalHtml(doc: LegalDoc, locale: string): string {
  const file = path.join(
    process.cwd(),
    "content",
    "legal",
    `${doc}-${locale === "fr" ? "fr" : "de"}.md`,
  );
  return marked.parse(readFileSync(file, "utf8"), { async: false });
}
