import { expect, test } from "@playwright/test";
import { login, traitNetIssues } from "./helpers";

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

const PUBLIC_PAGES = ["/de", "/fr", "/de/login", "/fr/login", "/de/signup", "/fr/signup"];

for (const size of WIDTHS) {
  test.describe(`Trait net à ${size.width} px`, () => {
    test.use({ viewport: size });

    for (const path of PUBLIC_PAGES) {
      test(`page publique ${path}`, async ({ page }) => {
        await page.goto(path);
        expect(await traitNetIssues(page)).toEqual([]);
      });
    }

    test("application, menus ouverts compris", async ({ page }) => {
      await login(page, "de");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.getByTestId("application-switcher").click();
      expect(await traitNetIssues(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByTestId("user-menu").click();
      expect(await traitNetIssues(page)).toEqual([]);
    });

    test("écran sans accès", async ({ page }) => {
      await login(page, "fr", {
        sub: `sub-na-${size.width}`,
        email: `na${size.width}@libre.test`,
        org: `org-na-${size.width}`,
        org_name: "Libre Sàrl",
        access: false,
      });
      expect(await traitNetIssues(page)).toEqual([]);
    });
  });
}
