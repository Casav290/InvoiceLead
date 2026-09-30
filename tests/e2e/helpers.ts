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
};

/** Connexion complète par le faux Compte Lead, depuis l'écran de connexion. */
export async function login(page: Page, locale: "de" | "fr" = "de", user?: FakeUser) {
  if (user) {
    const res = await page.request.post(`${LEAD}/test/next-user`, { data: user });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto(`/${locale}/login`);
  await page.getByTestId("lead-login").click();
  await page.waitForURL(`**/${locale}/app`);
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
