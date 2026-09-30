import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import fr from "../../messages/fr.json";

type Tree = { [key: string]: string | string[] | Tree };

function entries(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [[path, value] as [string, string]];
    if (Array.isArray(value)) return value.map((v, i) => [`${path}.${i}`, v] as [string, string]);
    return entries(value, path);
  });
}

describe("messages", () => {
  it("ont les mêmes clés en allemand et en français", () => {
    const keys = (t: Tree) =>
      entries(t)
        .map(([k]) => k)
        .sort();
    expect(keys(de as Tree)).toEqual(keys(fr as Tree));
  });

  it("n'ont pas de ß en allemand de Suisse", () => {
    expect(entries(de as Tree).filter(([, v]) => v.includes("ß"))).toEqual([]);
  });

  it("gardent la ponctuation française collée à son mot (espaces insécables)", () => {
    const bad = entries(fr as Tree).filter(([, v]) => / [?!;:%»]/.test(v) || /« /.test(v));
    expect(bad).toEqual([]);
  });
});
