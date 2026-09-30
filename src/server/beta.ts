/**
 * Bêta privée (BETA_ALLOWLIST) : une entrée est une organisation Lead, une adresse e-mail ou un
 * domaine précédé de « @ ». Sans liste, tout le monde entre.
 */
export function betaAllowed(
  allowlist: string | undefined,
  who: { leadOrg: string; email: string },
): boolean {
  const entries = (allowlist ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return true;
  const email = who.email.trim().toLowerCase();
  const domain = email.slice(email.lastIndexOf("@"));
  return entries.some(
    (e) =>
      (who.leadOrg !== "" && e === who.leadOrg.toLowerCase()) ||
      e === email ||
      (e.startsWith("@") && e === domain),
  );
}
