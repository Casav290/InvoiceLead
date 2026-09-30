import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
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
