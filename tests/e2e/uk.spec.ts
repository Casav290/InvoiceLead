import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("interface en anglais et entreprise britannique : facture en livres à 20 %, nominal ledger, déclaration MTD", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "en", {
    sub: `sub-gb-${run}`,
    email: `gb-${run}@studio.test`,
    org: `org-gb-${run}`,
    org_name: "Harper Studio Ltd",
  });

  await page.goto("/en/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByTestId("company-country").selectOption("GB");
  await company.getByLabel("Legal name").fill("Harper Studio Ltd");
  await company.getByLabel("Legal form").selectOption("ltd");
  await company.getByLabel("VAT registration number").fill("GB 980 7806 84");
  await company.getByLabel("Companies House number").fill("01234567");
  await company.getByLabel("Street").fill("Baker Street");
  await company.getByLabel("Number", { exact: true }).fill("221B");
  await company.getByLabel("Postcode").fill("NW1 6XE");
  await company.getByLabel("Town").fill("London");
  await company.getByLabel("IBAN", { exact: true }).fill("GB82 WEST 1234 5698 7654 32");
  await company.getByLabel("Company registered for VAT").check();
  await company.getByLabel("Settlement basis").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/en/app/contacts/new");
  const contact = page.getByTestId("contact-form");
  await contact.getByLabel("Name or company name").fill("Client Ltd");
  await page.getByTestId("contact-save").click();
  await expect(page).toHaveURL(/\/en\/app\/contacts\?saved=1$/);

  await page.goto("/en/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Customer", { exact: true }).selectOption({ label: "Client Ltd" });
  await form.getByLabel("Invoice language").selectOption("en");
  const line = page.getByTestId("invoice-line-0");
  await line.getByLabel("Description").fill("Design work");
  await line.getByLabel("Unit price excl. VAT").fill("1000");
  await expect(form).toContainText("GBP 1,200.00");
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Invoice issued/)).toBeVisible();
  await expect(page.locator("body")).toContainText("VAT No. GB980780684");
  await expect(page.locator("body")).toContainText("Company No. 01234567");

  const href = await page.getByTestId("document-pdf").getAttribute("href");
  const pdf = await page.request.get(href ?? "");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  await page.goto("/en/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await expect(page.locator("body")).toContainText("UK nominal ledger");
  await expect(page.locator("body")).toContainText("Trade debtors");
  await page.goto("/en/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page).toHaveURL(/opened=1/);
  await page.goto("/en/app/accounting");
  await page.getByTestId("post-pending").click();
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("1100");
  await expect(journal).toContainText("4000");
  await expect(journal).toContainText("2200");

  const today = new Date().toISOString().slice(0, 10);
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  await page.goto(`/en/app/accounting/vat?period=${quarterStart}`);
  await expect(page.getByTestId("figure-1")).toContainText("200.00");
  await expect(page.getByTestId("figure-6")).toContainText("1,000.00");
  await expect(page.getByTestId("figure-5")).toContainText("200.00");
});

test("pages publiques et légales en anglais", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  await page.goto("/en/legal/terms");
  await expect(page.locator("body")).toContainText(
    "In case of discrepancy, the German version prevails.",
  );
});
