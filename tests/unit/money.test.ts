import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, vatOf } from "@/lib/money";

describe("montants", () => {
  it("affiche à la suisse en allemand et en français", () => {
    expect(formatAmount(236_199, "de")).toBe("2’361.99".replace("’", "'"));
    expect(formatAmount(236_199, "fr")).toMatch(/^2\s361\.99$/u);
    expect(formatMoney(8_500, "de")).toBe("CHF 85.00");
  });

  it("calcule la TVA au centime, arrondi commercial", () => {
    expect(vatOf(218_500, 810)).toBe(17_699); // 176.985 → 176.99
    expect(vatOf(10_000, 260)).toBe(260);
    expect(vatOf(0, 810)).toBe(0);
  });
});
