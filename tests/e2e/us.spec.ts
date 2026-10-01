import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("entreprise américaine : facture en dollars à 8,875 %, EIN, format Letter, relevé de sales tax", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "en", {
    sub: `sub-us-${run}`,
    email: `us-${run}@lonestar.test`,
    org: `org-us-${run}`,
    org_name: "Lone Star Design LLC",
  });

  await page.goto("/en/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByTestId("company-country").selectOption("US");
  await expect(company.getByLabel("IBAN", { exact: true })).toHaveCount(0);
  await company.getByLabel("Legal name").fill("Lone Star Design LLC");
  await company.getByLabel("Legal form").selectOption("llc");
  await company.getByLabel("EIN (Employer Identification Number)").fill("12-3456789");
  await company.getByLabel("Street").fill("Congress Avenue");
  await company.getByLabel("Number", { exact: true }).fill("500");
  await company.getByLabel("Postcode").fill("78701");
  await company.getByLabel("Town").fill("Austin");
  await company.getByLabel("State", { exact: true }).fill("TX");
  await company.getByLabel("The business collects sales tax").check();
  await company.getByLabel("Combined sales tax rate (%)").fill("8.875");
  await company.getByLabel("Settlement basis").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/en/app/contacts/new");
  const contact = page.getByTestId("contact-form");
  await contact.getByLabel("Name or company name").fill("Client Inc");
  await contact.getByLabel("Country").selectOption("US");
  await contact.getByLabel("Street").fill("Main Street");
  await contact.getByLabel("Postcode").fill("10001");
  await contact.getByLabel("Town").fill("New York");
  await contact.getByLabel("State or region").fill("NY");
  await page.getByTestId("contact-save").click();
  await expect(page).toHaveURL(/\/en\/app\/contacts\?saved=1$/);

  await page.goto("/en/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Customer", { exact: true }).selectOption({ label: "Client Inc" });
  await form.getByLabel("Invoice language").selectOption("en");
  const line = page.getByTestId("invoice-line-0");
  await line.getByLabel("Description").fill("Design work");
  await line.getByLabel("Unit price excl. tax").fill("1000");
  await expect(form).toContainText("Sales tax 8.875");
  await expect(form).toContainText("USD 1,088.75");
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Invoice issued/)).toBeVisible();
  await expect(page.locator("body")).toContainText("EIN 12-3456789");
  await expect(page.locator("body")).toContainText("Austin, TX 78701");

  const href = await page.getByTestId("document-pdf").getAttribute("href");
  const pdf = await page.request.get(href ?? "");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).toString("latin1")).toContain("/MediaBox [0 0 612 792]");

  await page.goto("/en/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await expect(page.locator("body")).toContainText("Sales tax payable");
  await page.goto("/en/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page).toHaveURL(/opened=1/);
  await page.goto("/en/app/accounting");
  await page.getByTestId("post-pending").click();
  await expect(page.getByTestId("journal")).toContainText("2200");

  const today = new Date().toISOString().slice(0, 10);
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  await page.goto(`/en/app/accounting/vat?period=${quarterStart}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales tax report");
  await expect(page.getByTestId("figure-S3")).toContainText("1,000.00");
  await expect(page.getByTestId("figure-S4")).toContainText("88.75");
});
