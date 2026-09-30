import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LEAD, login, setupBilling } from "./helpers";

test("API Pro+ : clé, contact, facture émise et payée, PDF, webhooks signés", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-api-free-${run}`,
    email: `api-free-${run}@atelier.test`,
    org: `org-api-free-${run}`,
    org_name: "Sans API Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/settings/api");
  await expect(page.getByTestId("api-plan")).toContainText("formule Pro+");

  await page.context().clearCookies();
  await login(page, "fr", {
    sub: `sub-api-${run}`,
    email: `api-${run}@atelier.test`,
    org: `org-api-${run}`,
    org_name: "API Sàrl",
    plan: "proplus",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/api");
  await page
    .getByTestId("api-keys")
    .getByLabel(/Nom de la clé/)
    .fill("Boutique");
  await page.getByTestId("api-key-create").click();
  const key = (await page.getByTestId("api-key-secret").textContent())?.trim() ?? "";
  expect(key).toMatch(/^il_live_/);
  await expect(page.getByTestId("api-keys")).toContainText("Boutique");

  const hooks = page.getByTestId("webhooks");
  await hooks.getByLabel("Adresse de réception (https)").fill(`${LEAD}/hooks`);
  await page.getByTestId("webhook-create").click();
  const secret = (await page.getByTestId("webhook-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^whsec_/);
  await expect(page.getByTestId("webhook-row")).toContainText(`${LEAD}/hooks`);

  const api = page.request;
  const headers = { Authorization: `Bearer ${key}` };
  expect((await api.get("/api/v1/contacts")).status()).toBe(401);

  const contact = await api.post("/api/v1/contacts", {
    headers,
    data: { name: "Client API SA", language: "fr", email: "compta@client-api.test" },
  });
  expect(contact.status()).toBe(201);
  const contactId = (await contact.json()).data.id as string;

  const invalid = await api.post("/api/v1/invoices", { headers, data: { contactId, lines: [] } });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).fields.lines).toBe("noLines");

  const created = await api.post("/api/v1/invoices", {
    headers,
    data: {
      contactId,
      language: "fr",
      lines: [
        {
          description: "Abonnement",
          unit: "month",
          quantity: "2",
          unitPrice: "100",
          vatCode: "normal",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const draft = (await created.json()).data;
  expect(draft).toMatchObject({
    status: "draft",
    netCents: 20_000,
    vatCents: 1_620,
    totalCents: 21_620,
  });

  const issued = await api.post(`/api/v1/invoices/${draft.id}/issue`, { headers });
  expect(issued.status()).toBe(200);
  const number = (await issued.json()).data.number as string;
  expect(number).toMatch(/^\d{4}-\d{4}$/);
  expect((await api.post(`/api/v1/invoices/${draft.id}/issue`, { headers })).status()).toBe(409);

  const pdf = await api.get(`/api/v1/invoices/${draft.id}/pdf`, { headers });
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  const paid = await api.post(`/api/v1/invoices/${draft.id}/payments`, {
    headers,
    data: { amount: "216.20" },
  });
  expect(paid.status()).toBe(201);
  const detail = await (await api.get(`/api/v1/invoices/${draft.id}`, { headers })).json();
  expect(detail.data.balance.openCents).toBe(0);
  expect(detail.data.lines).toHaveLength(1);
  const list = await (await api.get("/api/v1/invoices", { headers })).json();
  expect(list.data[0]).toMatchObject({ number, openCents: 0, customer: "Client API SA" });

  // Les trois événements arrivent signés avec le secret de l'adresse.
  await expect
    .poll(async () => {
      const received = (await (await api.get(`${LEAD}/test/hooks`)).json()) as {
        body: string;
      }[];
      return received
        .map((h) => JSON.parse(h.body))
        .filter((b) => b.data?.invoice?.number === number)
        .map((b) => b.type)
        .sort();
    })
    .toEqual(["invoice.issued", "invoice.paid", "payment.created"]);
  const received = (await (await api.get(`${LEAD}/test/hooks`)).json()) as {
    headers: Record<string, string>;
    body: string;
  }[];
  const hook = received.find((h) => h.body.includes(number));
  if (!hook) throw new Error("webhook absent");
  const [t, v1] = (hook.headers["invoicelead-signature"] ?? "").split(",");
  const ts = t?.slice(2) ?? "";
  expect(v1).toBe(`v1=${createHmac("sha256", secret).update(`${ts}.${hook.body}`).digest("hex")}`);

  await page.reload();
  await expect(page.getByTestId("webhook-delivery").first()).toContainText("livré");
});
