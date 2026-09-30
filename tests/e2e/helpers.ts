import { expect, type Page } from "@playwright/test";

export const LEAD = "http://localhost:4010";

export type FakeUser = {
  sub?: string;
  email?: string;
  name?: string;
  org?: string;
  org_name?: string;
  org_role?: string;
  access?: boolean;
  plan?: "free" | "pro";
};

/** Connexion complète par le faux Compte Lead, depuis l'écran de connexion. */
export async function login(
  page: Page,
  locale: "de" | "fr" | "en" = "de",
  user?: FakeUser,
  landing = `**/${locale}/app`,
) {
  if (user) {
    const res = await page.request.post(`${LEAD}/test/next-user`, { data: user });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto(`/${locale}/login`);
  await page.getByTestId("lead-login").click();
  await page.waitForURL(landing);
}

/** Relevé « Trait net » : police, arrondis, ombres, dégradés, débordement horizontal. */
export async function traitNetIssues(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const issues: string[] = [];
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
        typeof el.className === "string" && el.className
          ? `.${el.className.split(/\s+/).slice(0, 3).join(".")}`
          : ""
      }`;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const radii = [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomLeftRadius,
        cs.borderBottomRightRadius,
      ];
      if (radii.some((r) => r !== "0px")) issues.push(`arrondi ${label(el)} ${radii.join(" ")}`);
      if (cs.boxShadow !== "none") issues.push(`ombre ${label(el)} ${cs.boxShadow}`);
      if (cs.textShadow !== "none") issues.push(`ombre de texte ${label(el)}`);
      if (/gradient/.test(cs.backgroundImage)) issues.push(`dégradé ${label(el)}`);
      const hasText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
      if (hasText) {
        const first = cs.fontFamily.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
        if (!/^Archivo/.test(first)) issues.push(`police ${label(el)} ${first}`);
      }
    }
    if (!document.fonts.check('16px "Archivo Variable"')) issues.push("Archivo non chargée");
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth)
      issues.push(`débordement ${root.scrollWidth} > ${root.clientWidth}`);
    return issues;
  });
}

/** Entreprise assujettie à la TVA avec adresse et IBAN, un client « Client SA » et un article « Conseil ». */
export async function setupBilling(page: Page) {
  // Données de l'entreprise, assujettie à la TVA.
  await page.goto("/fr/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByLabel("Raison sociale").fill("Factures Sàrl");
  await company.getByLabel("Forme juridique").selectOption("gmbh");
  await company.getByLabel("Numéro IDE").fill("CHE-116.281.710");
  await company.getByLabel("Rue").fill("Rue du Marché");
  await company.getByLabel("Numéro", { exact: true }).fill("4");
  await company.getByLabel("NPA").fill("1204");
  await company.getByLabel("Localité").fill("Genève");
  await company.getByLabel("IBAN", { exact: true }).fill("CH93 0076 2011 6238 5295 7");
  await company.getByLabel("Entreprise inscrite au registre TVA").check();
  await company.getByLabel("Méthode de décompte").selectOption("effective");
  await company.getByLabel("Décompte selon").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();

  await page.goto("/fr/app/contacts/new");
  await page.getByTestId("contact-form").getByLabel("Nom ou raison sociale").fill("Client SA");
  await page.getByTestId("contact-save").click();
  await page.goto("/fr/app/products/new");
  const product = page.getByTestId("product-form");
  await product.getByLabel("Désignation").fill("Conseil");
  await product.getByLabel("Prix unitaire hors TVA (CHF)").fill("150");
  await page.getByTestId("product-save").click();
}
