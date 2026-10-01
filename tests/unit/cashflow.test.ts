import { describe, expect, it } from "vitest";
import { buildForecast, mondayOf } from "@/server/cashflow";

describe("prévision de trésorerie", () => {
  it("cumule semaine par semaine et signale le premier découvert", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    const f = buildForecast(
      "CHF",
      100_000,
      [
        { weekStart: "2026-09-28", cents: 20_000 },
        { weekStart: "2026-10-12", cents: 50_000 },
        { weekStart: "2026-12-28", cents: 9_000 },
      ],
      [
        // Échue : semaine en cours.
        { date: "2026-09-15", cents: 30_000 },
        { date: "2026-10-07", cents: 150_000 },
        { date: "2027-02-01", cents: 1_000 },
      ],
      "2026-10-01",
      4,
    );
    expect(f.weeks.map((w) => [w.weekStart, w.inCents, w.outCents, w.closingCents])).toEqual([
      ["2026-09-28", 20_000, 30_000, 90_000],
      ["2026-10-05", 0, 150_000, -60_000],
      ["2026-10-12", 50_000, 0, -10_000],
      ["2026-10-19", 0, 0, -10_000],
    ]);
    expect(f.shortfall?.weekStart).toBe("2026-10-05");
    expect(f.laterInCents).toBe(9_000);
    expect(f.laterOutCents).toBe(1_000);
    expect(buildForecast("CHF", 5_000, [], [], "2026-10-01", 2).shortfall).toBeNull();
  });
});
