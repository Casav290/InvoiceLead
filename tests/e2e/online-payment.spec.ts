import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LEAD, login, setupBilling } from "./helpers";

test("paiement en ligne : Stripe relié, client qui paie depuis le lien, facture payée", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-pay-${run}`,
    email: `pay-${run}@atelier.test`,
    org: `org-pay-${run}`,
    org_name: "Paiements Sàrl",
  });
  await setupBilling(page);

  await page.goto("/fr/app/settings/payments");
  await page.getByTestId("stripe-connect").click();
  await expect(page.getByText("Compte Stripe relié.")).toBeVisible();
  await expect(page.getByTestId("stripe-account")).toContainText("acct_e2e");

  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  await page.getByTestId("share-link").click();
  const link = await page.getByTestId("share-url").inputValue();

  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(new URL(link).pathname);
  await guest.getByTestId("shared-pay").click();
  await guest.waitForURL(/\/stripe\/checkout\/cs_test_[\d_]+$/);
  const sessions = await (await guest.request.get(`${LEAD}/test/checkouts`)).json();
  const session = sessions.at(-1);
  expect(session.account).toBe("acct_e2e");
  expect(session.form["line_items[0][price_data][unit_amount]"]).toBe("16215");

  // Stripe prévient InvoiceLead du paiement abouti, notification signée.
  const payload = JSON.stringify({
    type: "checkout.session.completed",
    account: "acct_e2e",
    data: {
      object: {
        id: session.id,
        payment_status: "paid",
        amount_total: 16215,
        created: Math.floor(Date.now() / 1000),
        metadata: {
          invoice_id: session.form["metadata[invoice_id]"],
          organization_id: session.form["metadata[organization_id]"],
        },
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_e2e").update(`${t}.${payload}`).digest("hex");
  const forged = await guest.request.post("/api/stripe/webhook", {
    data: payload,
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": `t=${t},v1=${"0".repeat(64)}`,
    },
  });
  expect(forged.status()).toBe(400);
  const ok = await guest.request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` },
  });
  expect(await ok.json()).toMatchObject({ result: "recorded" });

  await guest.goto(`${new URL(link).pathname}?paid=1`);
  await expect(guest.getByTestId("shared-paid")).toBeVisible();
  await expect(guest.getByTestId("shared-pay")).toHaveCount(0);
  await visitor.close();

  await page.goto("/fr/app/invoices");
  await expect(page.getByRole("row", { name: /Client SA/ })).toContainText("Payée");
});
