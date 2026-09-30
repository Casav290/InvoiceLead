import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, vatOf } from "@/lib/money";

describe("montants", () => {
  it("affiche à la suisse par défaut, à l'allemande pour l'euro en Allemagne", () => {
    expect(formatAmount(236_199)).toBe("2'361.99");
    expect(formatAmount(236_199, "ch")).toBe("2'361.99");
    expect(formatAmount(123_456_789_00, "de")).toBe("123.456.789,00");
    expect(formatAmount(-5, "de")).toBe("-0,05");
    expect(formatAmount(123_456_789_00)).toBe("123'456'789.00");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(-8_500)).toBe("-85.00");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatMoney(8_500)).toBe("CHF 85.00");
    expect(formatMoney(100_000, "EUR", "de")).toBe("EUR 1.000,00");
  });

  it("refuse un montant qui n'est pas un entier de centimes", () => {
    expect(() => formatAmount(10.5)).toThrow();
    expect(() => formatAmount(Number.NaN)).toThrow();
  });

  it("calcule la TVA au centime, arrondi commercial", () => {
    expect(vatOf(218_500, 810)).toBe(17_699); // 176.985 → 176.99
    expect(vatOf(10_000, 260)).toBe(260);
    expect(vatOf(0, 810)).toBe(0);
  });

  it("arrondit un avoir comme la facture qu'il annule", () => {
    expect(vatOf(-218_500, 810)).toBe(-17_699);
    expect(vatOf(-218_500, 810)).toBe(-vatOf(218_500, 810));
    expect(Object.is(vatOf(-0, 810), 0)).toBe(true);
  });
});
