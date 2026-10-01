import { expect, test } from "@playwright/test";
import { samplePdf } from "../support/pdf";
import { login } from "./helpers";

test("application installable : manifeste, icônes et raccourcis", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/app" });
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual([
    "/app/accounting/receipts/capture",
    "/app/time",
  ]);
  for (const icon of manifest.icons) {
    const png = await page.request.get(icon.src);
    expect(png.headers()["content-type"]).toBe("image/png");
  }
  await page.goto("/fr");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
});

test("capture d'un justificatif depuis le téléphone : envoyé dès la photo, lu par l'IA", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "fr", {
    sub: `sub-cap-${run}`,
    email: `cap-${run}@atelier.test`,
    org: `org-cap-${run}`,
    org_name: "Photo Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/accounting/receipts/capture");
  await page.getByTestId("capture-input").setInputFiles({
    name: "ticket.pdf",
    mimeType: "application/pdf",
    buffer: await samplePdf(["Papeterie Muster", `Date ${today}`, "Total CHF 24.90"]),
  });
  await expect(page.getByTestId("capture-result")).toContainText("Justificatif lu");
  await expect(page.getByTestId("capture-result")).toContainText("24.90");
});
