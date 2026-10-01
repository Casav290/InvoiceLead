import { expect, test } from "@playwright/test";
import { login, traitNetIssues } from "./helpers";

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

const PUBLIC_PAGES = [
  "/de",
  "/fr",
  "/de/login?erreur=session",
  "/fr/login?erreur=lead",
  "/de/signup",
  "/fr/signup",
  "/fr/nexiste-pas",
  "/de/pricing",
  "/fr/pricing",
  "/de/faq",
  "/fr/faq",
  "/de/legal/privacy",
  "/fr/legal/terms",
  "/fr/legal/dpa",
  "/de/legal/imprint",
  "/en",
  "/en/pricing",
  "/en/faq",
  "/en/legal/privacy",
];

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
      await page.keyboard.press("Escape");
      await page.goto("/de/app/settings/company");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/contacts");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/contacts/new");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/products");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/products/new");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/settings/accounts");
      expect(await traitNetIssues(page)).toEqual([]);
      // Le même compte sert aux quatre largeurs : le plan n'est installé qu'au premier passage.
      if (await page.getByTestId("chart-install").count()) {
        await page.getByTestId("chart-install").click();
        await page.waitForURL("**/fr/app/settings/accounts?installed=1");
      }
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/settings/accounts/new");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/settings/fiscal-years");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/invoices");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/invoices/new");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/quotes");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/invoices/reminders");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/invoices/recurring");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/time");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/en/app/assistant");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/accounting/receipts/capture");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/time/projects");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/accounting");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/accounting/bank");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/accounting/review");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/accounting/bills");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/accounting/bills/new");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/accounting/receipts");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/fr/app/accounting/reports");
      expect(await traitNetIssues(page)).toEqual([]);
      await page.goto("/de/app/accounting/vat");
      expect(await traitNetIssues(page)).toEqual([]);
    });

    test("écran sans accès", async ({ page }) => {
      await login(
        page,
        "fr",
        {
          sub: `sub-na-${size.width}`,
          email: `na${size.width}@libre.test`,
          org: `org-na-${size.width}`,
          org_name: "Libre Sàrl",
          status: "retired",
        },
        "**/fr/no-access",
      );
      expect(await traitNetIssues(page)).toEqual([]);
    });
  });
}
