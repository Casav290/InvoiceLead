import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
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

  it("gardent la ponctuation française collée à son mot (espaces insécables)", () => {
    const bad = entries(fr as Tree).filter(([, v]) => / [?!;:%»]/.test(v) || /« /.test(v));
    expect(bad).toEqual([]);
  });
});
