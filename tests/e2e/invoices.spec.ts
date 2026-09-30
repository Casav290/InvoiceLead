import { expect, test } from "@playwright/test";
import { login, setupBilling, traitNetIssues } from "./helpers";

test("facture : brouillon avec article et ligne libre, émission avec numéro, facture figée", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-inv-${run}`,
    email: `inv-${run}@atelier.test`,
    org: `org-inv-${run}`,
    org_name: "Factures Sàrl",
  });

  await setupBilling(page);

  await page.getByRole("link", { name: "Factures" }).click();
  await page.getByTestId("invoice-new").click();
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  const line0 = page.getByTestId("invoice-line-0");
  await line0.getByLabel("Article").selectOption({ label: "Conseil" });
  await line0.getByLabel("Quantité").fill("2.5");
  await page.getByTestId("invoice-line-add").click();
  const line1 = page.getByTestId("invoice-line-1");
  await line1.getByLabel("Désignation").fill("Frais de déplacement");
  await line1.getByLabel("Prix unitaire HT").fill("40,5");
  await line1.getByLabel("TVA").selectOption("exempt");
  const totals = page.getByTestId("invoice-totals");
  await expect(totals).toContainText("415.50");
  await expect(totals).toContainText("30.38");
  await expect(totals).toContainText("CHF 445.88");

  await page.getByTestId("invoice-save").click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
  await expect(page.getByTestId("document-status")).toHaveText("Brouillon");

  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  const year = new Date().getFullYear();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Facture ${year}-0001`);
  const doc = page.getByTestId("invoice-document");
  await expect(doc).toContainText("CHE-116.281.710 TVA");
  await expect(doc).toContainText("Client SA");
  await expect(page.getByTestId("invoice-total")).toHaveText("CHF 445.88");
  await expect(page.getByTestId("invoice-form")).toHaveCount(0);

  const href = await page.getByTestId("document-pdf").getAttribute("href");
  const pdf = await page.request.get(href ?? "");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: "Toutes les factures" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${year}-0001`) })).toContainText("445.88");

  // Paiement partiel, puis avoir sur le solde.
  await page.getByRole("link", { name: `${year}-0001` }).click();
  await expect(page.getByTestId("payment-state")).toHaveText("Ouverte");
  const pay = page.getByTestId("payment-form");
  await expect(pay.getByLabel("Montant (CHF)")).toHaveValue("445.88");
  await pay.getByLabel("Montant (CHF)").fill("500");
  await page.getByTestId("payment-save").click();
  await expect(page.getByText("Le montant dépasse le solde ouvert.")).toBeVisible();
  await page.getByTestId("payment-form").getByLabel("Montant (CHF)").fill("400");
  await page.getByTestId("payment-save").click();
  await expect(page.getByText("Paiement enregistré.")).toBeVisible();
  await expect(page.getByTestId("payment-state")).toHaveText("Payée en partie");
  await expect(page.getByTestId("balance-openCents")).toHaveText("45.88");

  await page.getByTestId("credit-note-create").click();
  await expect(page).toHaveURL(/\/fr\/app\/credit-notes\/[0-9a-f-]+\?saved=1$/);
  await page.getByTestId("invoice-line-remove-0").click();
  await page.getByTestId("invoice-line-0").getByLabel("Prix unitaire HT").fill("45,88");
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Avoir G-${year}-0001`);
  await expect(page.getByTestId("invoice-document")).toContainText(
    `Concerne la facture ${year}-0001`,
  );

  await page.getByRole("link", { name: `Facture concernée : ${year}-0001` }).click();
  await expect(page.getByTestId("payment-state")).toHaveText("Payée");
  await expect(page.getByTestId("balance-openCents")).toHaveText("0.00");
  await expect(page.getByTestId("payment-form")).toHaveCount(0);

  // Envoi par e-mail, puis consultation par le lien, sans session.
  await page.getByRole("link", { name: "Factures" }).first().click();
  await page.getByRole("link", { name: `${year}-0001` }).click();
  const send = page.getByTestId("send-form");
  await send.getByLabel("Destinataire").fill("client@exemple.ch");
  await expect(send.getByLabel("Objet")).toHaveValue(`Facture ${year}-0001 de Factures Sàrl`);
  await page.getByTestId("send-submit").click();
  await expect(page.getByText("E-mail envoyé.")).toBeVisible();
  const emails = await (await page.request.get("http://localhost:4010/test/emails")).json();
  const mail = emails.at(-1);
  expect(mail.to).toEqual(["client@exemple.ch"]);
  expect(mail.from).toBe('"Factures Sàrl" <factures@invoicelead.io>');
  expect(mail.attachments[0].filename).toBe(`Facture-${year}-0001.pdf`);
  const link = /Consulter en ligne\u202f: (\S+)/.exec(mail.text)?.[1] ?? "";
  expect(link).toMatch(/\/fr\/d\/[A-Za-z0-9_-]{43}$/);

  const visitor = await page.context().browser()?.newContext();
  if (!visitor) throw new Error("navigateur");
  const guest = await visitor.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByTestId("invoice-document")).toContainText(`Facture ${year}-0001`);
  await guest.setViewportSize({ width: 320, height: 640 });
  expect(await traitNetIssues(guest)).toEqual([]);
  const shared = await guest.request.get(
    (await guest.getByTestId("shared-pdf").getAttribute("href")) ?? "",
  );
  expect(shared.headers()["content-type"]).toBe("application/pdf");
  await guest.goto("/fr/d/jeton-inconnu-jeton-inconnu-jeton-inconnu-00000");
  await expect(guest.getByTestId("invoice-document")).toHaveCount(0);
  await visitor.close();

  await page.reload();
  await expect(page.getByTestId("sent-info")).toContainText("client@exemple.ch");
  await expect(page.getByTestId("sent-info")).toContainText("Consulté en ligne.");
});
