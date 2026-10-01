import "server-only";
import { env } from "../env";

/**
 * Inviter une personne dans l'organisation Lead depuis InvoiceLead (API « members » du Compte Lead,
 * docs/LEAD-ID.md de CRMlead).
 *
 * Le Compte Lead crée l'accès et envoie lui-même l'email : au nom de l'application qui invite, jamais
 * de CRMlead, et son lien ramène la personne ici une fois son mot de passe choisi. L'invitation passe
 * par l'administrateur qui la lance (`inviter`, son identifiant Lead) : le Compte Lead vérifie qu'il
 * est bien administrateur de l'organisation, et que la formule a une place libre.
 *
 * Le secret de l'application ne suffit pas : l'administrateur prouve qu'il agit. Son jeton d'identité,
 * émis par le Compte Lead pour InvoiceLead à sa connexion (gardé dans sa session), part dans l'en-tête
 * `X-Lead-Id-Token` ; le Compte Lead en vérifie la signature, l'application, la date, et que son `sub`
 * et son `org` sont bien `inviter` et `org` (docs/LEAD-ID.md de CRMlead, étape 10).
 *
 * Jeton d'application à part (portée `members`) : la copie du kit leadId.ts ne se modifie pas ici.
 */

export type MemberInvite = {
  /** Organisation Lead (claims.org). */
  org: string;
  /** Identifiant Lead (claims.sub) de l'administrateur qui invite. */
  inviter: string;
  /** Jeton d'identité de l'administrateur (sa session) : la preuve qu'il agit lui-même. */
  idToken: string;
  email: string;
  name: string;
  locale: "de" | "fr" | "en";
};

export type InviteOutcome =
  | { status: "invited" }
  /** Déjà invitée, pas encore arrivée : l'invitation est renvoyée (l'ancien lien cesse de valoir). */
  | { status: "resent" }
  /** Invitation enregistrée, mais l'email n'est pas parti : un nouvel essai la renverra. */
  | { status: "notSent" }
  | { status: "seatLimit"; max: number | null }
  | { status: "alreadyMember" }
  | { status: "adminOnly" }
  | { status: "tooMany" }
  | { status: "failed" };

const TIMEOUT_MS = 10_000;
let cached: { token: string; until: number } | null = null;

const issuer = () => env().LEAD_ID_ISSUER.replace(/\/+$/, "");

async function membersToken(): Promise<string | null> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const { LEAD_ID_CLIENT_ID, LEAD_ID_CLIENT_SECRET } = env();
  const basic = Buffer.from(
    `${encodeURIComponent(LEAD_ID_CLIENT_ID)}:${encodeURIComponent(LEAD_ID_CLIENT_SECRET)}`,
  ).toString("base64");
  const r = await fetch(`${issuer()}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "members" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const out = (await r.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (!r.ok || typeof out.access_token !== "string") {
    console.error("[lead-id] members token", r.status);
    return null;
  }
  const seconds = typeof out.expires_in === "number" ? out.expires_in : 300;
  cached = { token: out.access_token, until: Date.now() + seconds * 1000 };
  return cached.token;
}

type Answer = { status: number; body: Record<string, unknown> };

async function post(path: string, body: unknown, idToken: string): Promise<Answer | null> {
  const token = await membersToken();
  if (!token) return null;
  const r = await fetch(`${issuer()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Lead-Id-Token": idToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Jeton refusé (secret changé, portée retirée) : le suivant sera redemandé.
  if (r.status === 401) cached = null;
  const out = await r.json().catch(() => ({}));
  return { status: r.status, body: out && typeof out === "object" ? out : {} };
}

function refused(answer: Answer): InviteOutcome {
  const { status, body } = answer;
  if (status === 402)
    return { status: "seatLimit", max: Number.isInteger(body.max) ? Number(body.max) : null };
  if (status === 409) return { status: "alreadyMember" };
  // `forbidden` (pas administrateur) ou `inviter_proof` (jeton d'identité refusé, session d'avant le
  // changement de rôle) : seul l'administrateur, connecté, invite.
  if (status === 403) return { status: "adminOnly" };
  if (status === 429) return { status: "tooMany" };
  console.error("[lead-id] members", status, typeof body.error === "string" ? body.error : "");
  return { status: "failed" };
}

export async function inviteMember(invite: MemberInvite): Promise<InviteOutcome> {
  const { idToken, ...body } = invite;
  if (!idToken) return { status: "failed" };
  try {
    const answer = await post("/api/lead-id/v1/members/invite", body, idToken);
    if (!answer) return { status: "failed" };
    if (answer.status >= 200 && answer.status < 300)
      return answer.body.emailSent === false ? { status: "notSent" } : { status: "invited" };
    // Déjà invitée mais jamais arrivée (email perdu, lien échu) : on renvoie l'invitation.
    const { id, active } = answer.body;
    if (answer.status === 409 && active === false && typeof id === "string" && id) {
      const again = await post(
        `/api/lead-id/v1/members/${encodeURIComponent(id)}/invite`,
        { org: invite.org, inviter: invite.inviter, locale: invite.locale },
        idToken,
      );
      if (!again) return { status: "failed" };
      if (again.status >= 200 && again.status < 300) return { status: "resent" };
      if (again.status === 502) return { status: "notSent" };
      return refused(again);
    }
    return refused(answer);
  } catch (error) {
    console.error("[lead-id] members", error instanceof Error ? error.name : "erreur");
    return { status: "failed" };
  }
}
