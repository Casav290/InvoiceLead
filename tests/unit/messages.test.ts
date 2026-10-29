import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { ASSISTANT_TOKENS, PLANS } from "@/server/plans";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import it_ from "../../messages/it.json";

type Tree = { [key: string]: Node };
type Node = string | Node[] | Tree;

function entries(node: Node, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  const pairs = Array.isArray(node)
    ? node.map((v, i) => [String(i), v] as const)
    : Object.entries(node);
  return pairs.flatMap(([key, value]) => entries(value, prefix ? `${prefix}.${key}` : key));
}

/** Noms des variables ICU d'un message, branches de pluriel et de sélection comprises. */
function argumentNames(elements: MessageFormatElement[], found = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (
      "value" in el &&
      el.type !== TYPE.literal &&
      el.type !== TYPE.tag &&
      typeof el.value === "string"
    )
      found.add(el.value);
    if ("options" in el)
      for (const option of Object.values(el.options)) argumentNames(option.value, found);
    if ("children" in el) argumentNames(el.children, found);
  }
  return found;
}

describe("messages", () => {
  it("ont les mêmes clés dans les cinq langues (allemand, français, anglais, italien, espagnol)", () => {
    const keys = (t: Tree) =>
      entries(t)
        .map(([k]) => k)
        .sort();
    for (const t of [de, en, it_, es]) expect(keys(t as Tree)).toEqual(keys(fr as Tree));
  });

  for (const [lang, messages] of [
    ["de", de],
    ["en", en],
    ["it", it_],
    ["es", es],
  ] as const)
    it(`gardent en ${lang} les variables et les balises de chaque message`, () => {
      const vars = (v: string) => [...argumentNames(parse(v, { ignoreTag: true }))].sort();
      const tags = (v: string) => [...v.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();
      const other = new Map(entries(messages as Tree));
      const bad = entries(fr as Tree).filter(
        ([k, v]) =>
          JSON.stringify(vars(v)) !== JSON.stringify(vars(other.get(k) ?? "")) ||
          JSON.stringify(tags(v)) !== JSON.stringify(tags(other.get(k) ?? "")),
      );
      expect(bad).toEqual([]);
    });

  it("sont vraiment traduits en italien et en espagnol (pas de repli en français ni en anglais)", () => {
    const french = new Map(entries(fr as Tree));
    const english = new Map(entries(en as Tree));
    for (const t of [it_, es]) {
      const all = entries(t as Tree).filter(([, v]) => v.trim().length > 12);
      const copied = all.filter(([k, v]) => v === french.get(k) || v === english.get(k));
      // Restent identiques seulement des sigles, adresses et noms propres longs (moins de 2 %).
      expect(copied.length / all.length).toBeLessThan(0.02);
      expect(entries(t as Tree).filter(([, v]) => v.includes("\u202f"))).toEqual([]);
    }
  });

  it("n'ont pas de ß en allemand de Suisse", () => {
    expect(entries(de as Tree).filter(([, v]) => v.includes("ß"))).toEqual([]);
  });

  it("n'ont ni tiret cadratin ni tiret demi-cadratin (consigne d'écriture d'Ève)", () => {
    for (const t of [de, fr, en, it_, es])
      expect(entries(t as Tree).filter(([, v]) => /[\u2013\u2014]/.test(v))).toEqual([]);
  });

  it("gardent la ponctuation française collée à son mot (espaces insécables)", () => {
    const bad = entries(fr as Tree).filter(([, v]) => / [?!;:%»]/.test(v) || /« /.test(v));
    expect(bad).toEqual([]);
  });

  it("entourent les guillemets français d'espaces fines insécables, partout les mêmes", () => {
    const bad = entries(fr as Tree).filter(([, v]) => /«(?!\u202f)|(?<!\u202f)»/.test(v));
    expect(bad).toEqual([]);
  });
});

/**
 * Tarifs et FAQ écrivent les allocations en toutes lettres : chaque chiffre doit rester celui de
 * PLANS (src/server/plans.ts), dans les cinq langues. L'ordre des lignes est celui de la page
 * Tarifs (et de ses étiquettes « Bientôt »).
 */
describe("tarifs et FAQ face aux formules", () => {
  type Copy = {
    pricing: { plans: Record<"free" | "pro" | "proPlus", { features: string[] }> };
    faq: { items: { q: string; a: string }[] };
  };
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).map(Number);
  const free = PLANS.free.quotas;
  /** L'assistant IA est un budget de jetons, dit en demandes-types (« l'équivalent de 10 demandes »). */
  const assistantRequests = free.assistant / ASSISTANT_TOKENS.perRequest;

  for (const [lang, copy] of [
    ["de", de],
    ["fr", fr],
    ["en", en],
    ["it", it_],
    ["es", es],
  ] as [string, Copy][]) {
    it(`reprennent les chiffres de PLANS (${lang})`, () => {
      const plans = copy.pricing.plans;
      const lines: [string | undefined, number][] = [
        [plans.free.features[0], PLANS.free.seats],
        [plans.free.features[1], free.invoices],
        [plans.free.features[2], free.contacts],
        [plans.free.features[5], free.aiReads],
        [plans.free.features[6], assistantRequests],
        [plans.free.features[7], free.reminders],
        [plans.free.features[8], free.recurring],
        [plans.free.features[9], free.bankImports],
        [plans.pro.features[1], PLANS.pro.seats],
        [plans.pro.features[2], PLANS.pro.quotas.aiReads],
        [plans.proPlus.features[0], PLANS.proplus.seats],
        [plans.proPlus.features[1], PLANS.proplus.quotas.aiReads],
      ];
      for (const [line, expected] of lines) expect(numbers(line ?? "")[0]).toBe(expected);
      // « Que comprend la formule gratuite ? » : dans l'ordre de la réponse.
      expect(numbers(copy.faq.items[7]?.a ?? "")).toEqual([
        free.invoices,
        free.aiReads,
        assistantRequests,
        free.reminders,
        free.bankImports,
        free.contacts,
        free.recurring,
      ]);
    });
  }
});
