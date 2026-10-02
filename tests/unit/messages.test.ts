import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/server/plans";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

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
  it("ont les mêmes clés en allemand, en français et en anglais", () => {
    const keys = (t: Tree) =>
      entries(t)
        .map(([k]) => k)
        .sort();
    expect(keys(de as Tree)).toEqual(keys(fr as Tree));
    expect(keys(en as Tree)).toEqual(keys(fr as Tree));
  });

  it("gardent en anglais les variables de chaque message", () => {
    const vars = (v: string) => [...argumentNames(parse(v, { ignoreTag: true }))].sort();
    const english = new Map(entries(en as Tree));
    const bad = entries(fr as Tree).filter(
      ([k, v]) => JSON.stringify(vars(v)) !== JSON.stringify(vars(english.get(k) ?? "")),
    );
    expect(bad).toEqual([]);
  });

  it("n'ont pas de ß en allemand de Suisse", () => {
    expect(entries(de as Tree).filter(([, v]) => v.includes("ß"))).toEqual([]);
  });

  it("n'ont ni tiret cadratin ni tiret demi-cadratin (consigne d'écriture d'Ève)", () => {
    for (const t of [de, fr, en])
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
 * PLANS (src/server/plans.ts), dans les trois langues. L'ordre des lignes est celui de la page
 * Tarifs (et de ses étiquettes « Bientôt »).
 */
describe("tarifs et FAQ face aux formules", () => {
  type Copy = {
    pricing: { plans: Record<"free" | "pro" | "proPlus", { features: string[] }> };
    faq: { items: { q: string; a: string }[] };
  };
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).map(Number);
  const free = PLANS.free.quotas;

  for (const [lang, copy] of [
    ["de", de],
    ["fr", fr],
    ["en", en],
  ] as [string, Copy][]) {
    it(`reprennent les chiffres de PLANS (${lang})`, () => {
      const plans = copy.pricing.plans;
      const lines: [string | undefined, number][] = [
        [plans.free.features[0], PLANS.free.seats],
        [plans.free.features[1], free.invoices],
        [plans.free.features[2], free.contacts],
        [plans.free.features[5], free.aiReads],
        [plans.free.features[6], free.assistant],
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
        free.assistant,
        free.reminders,
        free.bankImports,
        free.contacts,
        free.recurring,
      ]);
    });
  }
});
