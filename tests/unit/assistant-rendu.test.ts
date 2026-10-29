import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { failureState } from "@/components/assistant/confirm-state";
import { replyNodes, tidyReply } from "@/components/assistant/reply-text";
import { LOCALES } from "@/i18n/locales";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import it_ from "../../messages/it.json";

/**
 * Alignement des bulles (28.10.2026), côté navigateur sans navigateur : le rendu du texte du modèle
 * (B6) tel que React l'écrit dans la page, et l'état d'une carte refusée (B7). Les mêmes points sont
 * vus dans Chromium par tests/e2e/assistant-bubble.spec.ts.
 */
const html = (text: string, locale = "en") =>
  renderToStaticMarkup(createElement("p", null, replyNodes(text, locale)));

const MESSAGES = { de, fr, en, it: it_, es } as const;

describe("B6 : rendu du texte du modèle", () => {
  it("rendu du texte : **gras** → <strong>, <br> → saut de ligne, titre sans #, tableau en ligne simple, <script> reste du texte", () => {
    expect(html("Le devis est **prêt** à confirmer.")).toBe(
      "<p>Le devis est <strong>prêt</strong> à confirmer.</p>",
    );
    expect(html("Ligne un<br>ligne deux<br/>ligne trois<BR />fin")).toBe(
      "<p>Ligne un\nligne deux\nligne trois\nfin</p>",
    );
    expect(html("## Factures en retard\nDeux factures.")).toBe(
      "<p>Factures en retard\nDeux factures.</p>",
    );
    const table = html(
      "| Numéro | Client | Montant |\n|---|:---:|---:|\n| RE-1 | Kunde AG | CHF 300.00 |",
    );
    expect(table).toBe("<p>Numéro · Client · Montant\nRE-1 · Kunde AG · CHF 300.00</p>");
    expect(html("Numéro | Client\n--- | ---\nRE-1 | Kunde AG")).toBe(
      "<p>Numéro · Client\nRE-1 · Kunde AG</p>",
    );
    const script = html('<script>alert("x")</script><b>gras ?</b> <img src=x onerror=alert(1)>');
    expect(script).not.toMatch(/<script|<b>|<img/);
    expect(script).toContain("&lt;script&gt;");
    expect(script).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // Aucun balisage ne reste visible : ni séparateur de tableau, ni <br, ni **, ni # de titre.
    const mixed = tidyReply(
      "# Titre\n**Total** : 3 CHF<br>| a | b |\n|---|---|\n**seul\n```\ncode\n```",
    );
    expect(mixed).not.toMatch(/\|\s*-{3}|<br|^#/m);
    expect(html("# Titre\n**Total** : 3 CHF<br>**seul")).not.toContain("**");
  });

  it("typographie française en français seulement : rien de changé en anglais", () => {
    expect(html("Total : 300 CHF ? « oui »", "fr")).toBe("<p>Total : 300 CHF ? « oui »</p>");
    expect(html("Total : 300 CHF ? « oui »", "en")).toBe("<p>Total : 300 CHF ? « oui »</p>");
    expect(html("Summe : 300 CHF ?", "de")).toBe("<p>Summe : 300 CHF ?</p>");
  });

  it("la bulle n'écrit jamais de HTML brut : ni innerHTML ni dangerouslySetInnerHTML", () => {
    for (const file of ["AssistantBubble.tsx", "reply-text.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src/components/assistant", file), "utf8");
      expect(source).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
    }
    const bubble = readFileSync(
      join(process.cwd(), "src/components/assistant/AssistantBubble.tsx"),
      "utf8",
    );
    expect(bubble).toContain("{replyNodes(it.text, locale)}");
  });
});

describe("B7 : refus de « Confirmer », chacun son texte", () => {
  it("erreurs de « Confirmer » : chaque refus a son état et son texte traduit, distincts (cinq langues)", () => {
    expect(failureState(403, "token_used")).toBe("used");
    expect(failureState(403, "invalid_token")).toBe("expired");
    expect(failureState(403, "forbidden_role")).toBe("forbidden");
    expect(failureState(403, "cross_origin")).toBe("forbidden");
    expect(failureState(422, "contact_not_found")).toBe("gone");
    expect(failureState(422, "op 3: product_not_found")).toBe("gone");
    expect(failureState(422, "plan_limit")).toBe("planLimit");
    expect(failureState(401, undefined)).toBe("session");
    expect(failureState(422, "no_change")).toBe("failed");
    for (const l of LOCALES) {
      const c = MESSAGES[l].app.aiBubble.confirm as Record<string, unknown>;
      const texts = ["expired", "used", "forbidden", "gone", "network", "failed"].map((k) =>
        String(c[k] ?? ""),
      );
      expect(
        texts.every((x) => x.length > 10),
        l,
      ).toBe(true);
      expect(new Set(texts).size, l).toBe(texts.length);
    }
  });
});
