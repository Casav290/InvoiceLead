/**
 * Faux Compte Lead pour les tests de bout en bout : un émetteur OpenID Connect minimal qui signe
 * pour de bon (RS256) et vérifie PKCE, l'adresse de retour et le secret du client. Sans cela, les
 * tests ne prouveraient rien du branchement réel (même principe que les faux fournisseurs de CRMlead).
 *
 *   node tests/support/fake-lead-id.mjs            (port 4010)
 *   POST /test/next-user  {sub,email,name,org,org_name,org_role,access,plan,status,locale}  choisit la prochaine personne
 *     (plan_source « own » ou « family » et plan_until : d'où vient la formule et jusqu'à quand, comme
 *     ERPlead par application ; « family » ajoute l'abonnement hérité de CRMlead)
 *   Session du Compte Lead : une connexion (authorize sans prompt) pose le cookie « fake_lead_sid » ;
 *     authorize avec prompt=none rend un code pour sa personne, sans écran, ou, sans lui,
 *     error=login_required (comme ERPlead) ; /oauth/logout l'efface. GET /test/authorizes relit les
 *     demandes reçues (prompt, ui_locales)
 *   POST /resend/emails   imite l'API d'envoi de Resend (clé « re_test ») ; GET /test/emails les relit
 *   POST /api/lead-id/v1/members/invite  invitation dans l'organisation ; GET /test/member-invites les relit
 *     (comme le Compte Lead : jeton d'identité de l'administrateur dans X-Lead-Id-Token, sinon 403)
 *   POST /ai/chat/completions  faux assistant comptable : chaque sortie d'argent va en frais bancaires
 *   /oauth/logout ferme la session du Compte Lead de CE navigateur et poste à l'application un logout_token
 *     « logout » avec son `sid` ; POST /test/disable {sub,org} imite un départ (« disabled », sans sid) ;
 *     GET /test/backchannels relit les envois. Chaque jeton d'identité porte le `sid` du navigateur.
 *   POST /oauth/token (refresh_token)  le jeton de rafraîchissement tourne, comme au Compte Lead (un jeton
 *     déjà tourné ou révoqué : invalid_grant) ; POST /test/revoke-refresh {sub} révoque tous ceux d'une
 *     personne (mot de passe réinitialisé, déconnexion de partout), GET /test/refreshes compte les échanges
 *   POST /api/lead-id/v1/subscriptions (jeton « billing ») : déclaration d'un abonnement, comme ERPlead
 *     par application (formule d'InvoiceLead tirée de ses abonnements) ; GET /test/billing-reports les relit
 *   /stripe-billing/v1/… : faux Stripe de l'abonnement InvoiceLead (clé « sk_test_billing_e2e ») :
 *     clients, sessions Checkout (GET /stripe-billing/checkout/<id> : « Payer » revient au success_url,
 *     « Annuler » au cancel_url),
 *     abonnements, portail ; GET /test/billing relit tout, POST /test/billing/subscriptions/<id> change
 *     un abonnement (statut, résiliation en fin de période)
 */
import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_LEAD_ID_PORT ?? 4010);
const emails = [];
const ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.LEAD_ID_CLIENT_ID ?? "invoicelead";
const CLIENT_SECRET = process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_secret";
const REDIRECT_URI = process.env.LEAD_ID_REDIRECT_URI ?? "http://localhost:3100/auth/lead/callback";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "fake-1";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const defaultUser = {
  sub: "sub-ada",
  email: "ada@atelier.test",
  name: "Ada Muster",
  org: "org-atelier",
  org_name: "Atelier Muster GmbH",
  org_role: "admin",
  access: true,
};
let nextUser = { ...defaultUser };
const codes = new Map();
/** Sessions du Compte Lead ouvertes dans un navigateur : cookie « fake_lead_sid » → personne. */
const leadSessions = new Map();
const SID_COOKIE = "fake_lead_sid";
/** Demandes /oauth/authorize reçues (prompt, langue), pour compter les essais silencieux. */
const authorizes = [];
/** Jetons de rafraîchissement valables : jeton → personne (claims de sa connexion). */
const refreshTokens = new Map();
let refreshes = 0;
const logouts = [];
const memberInvites = [];
const memberResends = [];
const MEMBERS_TOKEN = "members-token";
const BILLING_TOKEN = "billing-token";
/** Déclarations d'abonnements reçues (comme ERPlead), par organisation. */
const billingReports = [];
/** Faux Stripe de l'abonnement InvoiceLead. */
const billing = { customers: [], checkouts: [], portals: [], subscriptions: new Map() };
const BILLING_KEY = "Bearer sk_test_billing_e2e";
/** Identifiants uniques d'un lancement à l'autre : la base des tests, elle, reste. */
const STARTED = Date.now().toString(36);
const PLAN_ROWS = {
  free: { code: "free", name: "Gratuit", rank: 0, seats: 1 },
  pro: { code: "pro", name: "Pro", rank: 10, seats: 1 },
  pro_plus: { code: "pro_plus", name: "Pro+", rank: 20, seats: 5 },
};

const b64url = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function jwt(claims) {
  const head = b64url({ alg: "RS256", typ: "JWT", kid: KID });
  const body = b64url(claims);
  const sig = createSign("RSA-SHA256")
    .update(`${head}.${body}`)
    .sign(privateKey)
    .toString("base64url");
  return `${head}.${body}.${sig}`;
}

/** `sid` : la session du Compte Lead (le navigateur) qui a donné le code, comme ERPlead. */
function idTokenFor(u, nonce, sid) {
  const now = Math.floor(Date.now() / 1000);
  return jwt({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: u.sub,
    iat: now,
    exp: now + 600,
    auth_time: now,
    ...(nonce ? { nonce } : {}),
    ...(sid ? { sid } : {}),
    email: u.email,
    email_verified: true,
    name: u.name,
    locale: u.locale ?? "fr",
    zoneinfo: "Europe/Zurich",
    org: u.org,
    org_name: u.org_name,
    org_role: u.org_role,
    lead: {
      // Comme ERPlead (table plans) : rangs 0, 10 et 20, une place en Pro, cinq en Pro+.
      plan: {
        ...(u.plan === "proplus"
          ? { code: "pro_plus", name: "Pro+", rank: 20, seats: 5 }
          : u.plan === "pro"
            ? { code: "pro", name: "Pro", rank: 10, seats: 1 }
            : { code: "free", name: "Gratuit", rank: 0, seats: 1 }),
        ...(u.plan_source ? { source: u.plan_source } : {}),
        ...(u.plan_until ? { valid_until: u.plan_until } : {}),
      },
      apps: {
        scanlead: {
          access: true,
          name: "ScanLead",
          url: "https://scanlead.io",
          status: "live",
          upgrade_url: "https://scanlead.io/billing",
        },
        crmlead: {
          access: true,
          name: "CRMlead",
          url: "https://crmlead.io",
          status: "live",
          upgrade_url: "https://crmlead.io/settings#billing",
        },
        projectlead: {
          access: true,
          name: "ProjectLead",
          url: null,
          status: "soon",
          upgrade_url: null,
        },
        invoicelead: {
          access: u.access,
          name: "InvoiceLead",
          url: "http://localhost:3100",
          status: u.status ?? "live",
          upgrade_url: "http://localhost:3100/fr/app/settings/plan",
        },
      },
      // Héritage de la transition : l'abonnement CRMlead d'avant la bascule donne encore la formule.
      subscriptions:
        u.plan_source === "family"
          ? [
              {
                app: "crmlead",
                plan: "team",
                lead_plan: u.plan === "pro" ? "pro" : "pro_plus",
                status: "active",
                current_period_end: u.plan_until ?? null,
                inherited: true,
                family_until: u.plan_until ?? null,
              },
            ]
          : [],
    },
  });
}

/**
 * Preuve que l'administrateur agit (membres) : son jeton d'identité, signé ici, émis pour cette
 * application, de moins de douze heures, au nom de `inviter` dans `org`. Même règle que le Compte Lead.
 */
function inviterProven(req, body) {
  const token = req.headers["x-lead-id-token"];
  if (typeof token !== "string") return false;
  const [head, payload, sig] = token.split(".");
  if (!head || !payload || !sig) return false;
  const signed = createVerify("RSA-SHA256")
    .update(`${head}.${payload}`)
    .verify(publicKey, Buffer.from(sig, "base64url"));
  if (!signed) return false;
  const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  const age = Math.floor(Date.now() / 1000) - Number(c.iat);
  return (
    c.iss === ISSUER &&
    aud.includes(CLIENT_ID) &&
    age >= -60 &&
    age <= 12 * 3600 &&
    c.sub === body.inviter &&
    c.org === body.org
  );
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** Sessions Checkout créées, pour les tests. */
const checkouts = [];
/** Webhooks reçus, pour les tests. */
const hooks = [];

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

/** logout_token envoyés à l'application (OpenID Connect Back-Channel Logout), comme ERPlead. */
const backchannels = [];
async function backchannel(claims) {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt({
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: now,
    exp: now + 120,
    jti: randomBytes(8).toString("hex"),
    ...claims,
    events: { "http://schemas.openid.net/event/backchannel-logout": {} },
  });
  const target = `${new URL(REDIRECT_URI).origin}/auth/lead/backchannel-logout`;
  const status = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ logout_token: token }),
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.status)
    .catch(() => 0);
  backchannels.push({ ...claims, status });
  return status;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  const q = url.searchParams;

  if (url.pathname === "/oauth/jwks") return send(res, 200, { keys: [jwk] });

  if (url.pathname === "/oauth/authorize") {
    if (q.get("client_id") !== CLIENT_ID || q.get("redirect_uri") !== REDIRECT_URI) {
      return send(res, 400, { error: "invalid_client_or_redirect" });
    }
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
      return send(res, 400, { error: "pkce_required" });
    }
    authorizes.push({ prompt: q.get("prompt"), ui_locales: q.get("ui_locales") });
    const back = new URL(REDIRECT_URI);
    back.searchParams.set("state", q.get("state") ?? "");
    const sid = /(?:^|;\s*)fake_lead_sid=([0-9a-f]+)/.exec(req.headers.cookie ?? "")?.[1];
    const headers = {};
    let user;
    let browser = sid;
    if (q.get("prompt") === "none") {
      // Essai silencieux : la personne de la session ouverte, sinon login_required, sans écran.
      user = sid ? leadSessions.get(sid) : undefined;
      if (!user) {
        back.searchParams.set("error", "login_required");
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
    } else {
      // « Écran de connexion » : la prochaine personne choisie par le test se connecte, et sa session
      // du Compte Lead reste ouverte dans ce navigateur.
      user = nextUser;
      nextUser = { ...defaultUser };
      const opened = randomBytes(12).toString("hex");
      browser = opened;
      leadSessions.set(opened, user);
      headers["Set-Cookie"] = `${SID_COOKIE}=${opened}; Path=/; HttpOnly; SameSite=Lax`;
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      user,
      sid: browser,
      nonce: q.get("nonce"),
      challenge: q.get("code_challenge"),
      at: Date.now(),
    });
    back.searchParams.set("code", code);
    res.writeHead(302, { Location: back.toString(), ...headers });
    return res.end();
  }

  if (url.pathname === "/oauth/token" && req.method === "POST") {
    const auth = Buffer.from(
      (req.headers.authorization ?? "").replace(/^Basic /, ""),
      "base64",
    ).toString();
    if (auth !== `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`) {
      return send(res, 401, { error: "invalid_client" });
    }
    const form = new URLSearchParams(await readBody(req));
    // Jeton d'application (portée « members » : invitations dans l'organisation ; « billing » :
    // déclaration des abonnements).
    if (form.get("grant_type") === "client_credentials") {
      const scopes = (form.get("scope") ?? "").split(" ");
      if (scopes.includes("billing"))
        return send(res, 200, {
          access_token: BILLING_TOKEN,
          token_type: "Bearer",
          expires_in: 600,
          scope: "billing",
        });
      if (!scopes.includes("members")) return send(res, 400, { error: "invalid_scope" });
      return send(res, 200, {
        access_token: MEMBERS_TOKEN,
        token_type: "Bearer",
        expires_in: 600,
        scope: "members",
      });
    }
    if (form.get("grant_type") === "refresh_token") {
      const token = form.get("refresh_token") ?? "";
      const held = refreshTokens.get(token);
      refreshTokens.delete(token);
      refreshes += 1;
      if (!held) return send(res, 400, { error: "invalid_grant" });
      const u = held.user ?? held;
      const next = randomBytes(16).toString("hex");
      refreshTokens.set(next, held);
      return send(res, 200, {
        access_token: randomBytes(16).toString("hex"),
        id_token: idTokenFor(u, null, held.sid),
        refresh_token: next,
        expires_in: 600,
        scope: "openid email profile lead offline_access",
        token_type: "Bearer",
      });
    }
    const entry = codes.get(form.get("code"));
    codes.delete(form.get("code"));
    if (!entry || Date.now() - entry.at > 120_000)
      return send(res, 400, { error: "invalid_grant" });
    if (form.get("redirect_uri") !== REDIRECT_URI)
      return send(res, 400, { error: "invalid_grant" });
    const challenge = createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url");
    if (challenge !== entry.challenge) return send(res, 400, { error: "invalid_grant" });

    const idToken = idTokenFor(entry.user, entry.nonce, entry.sid);
    const refreshToken = randomBytes(16).toString("hex");
    refreshTokens.set(refreshToken, { user: entry.user, sid: entry.sid });
    return send(res, 200, {
      access_token: randomBytes(16).toString("hex"),
      id_token: idToken,
      refresh_token: refreshToken,
      expires_in: 600,
      scope: "openid email profile lead offline_access",
      token_type: "Bearer",
    });
  }

  if (url.pathname === "/oauth/logout") {
    logouts.push({ client_id: q.get("client_id"), id_token_hint: q.get("id_token_hint") });
    const sid = /(?:^|;\s*)fake_lead_sid=([0-9a-f]+)/.exec(req.headers.cookie ?? "")?.[1];
    const closing = sid ? leadSessions.get(sid) : undefined;
    if (sid) leadSessions.delete(sid);
    // Comme ERPlead : la session de CE navigateur se ferme, ses jetons de rafraîchissement tombent, et
    // l'application reçoit un logout_token « logout » avec ce sid (ses autres navigateurs restent).
    if (closing && sid) {
      for (const [token, held] of refreshTokens) if (held.sid === sid) refreshTokens.delete(token);
      await backchannel({ sub: closing.sub, org: closing.org, lead_status: "logout", sid });
    }
    res.writeHead(302, {
      Location: q.get("post_logout_redirect_uri") ?? "/",
      "Set-Cookie": `${SID_COOKIE}=; Path=/; Max-Age=0`,
    });
    return res.end();
  }

  // Invitation d'une personne dans l'organisation (mêmes réponses que le Compte Lead) : places pleines
  // si l'adresse commence par « plein », compte actif si elle commence par « actif », invitation
  // renvoyée si elle a déjà été invitée.
  if (url.pathname === "/api/lead-id/v1/members/invite" && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${MEMBERS_TOKEN}`)
      return send(res, 401, { error: "invalid_token" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!inviterProven(req, body)) return send(res, 403, { error: "inviter_proof" });
    if (String(body.email).startsWith("plein"))
      return send(res, 402, { error: "seat_limit", max: 5 });
    if (String(body.email).startsWith("actif"))
      return send(res, 409, { error: "already_member", id: "usr_actif", active: true });
    const known = memberInvites.findIndex((i) => i.email === body.email && i.org === body.org);
    if (known >= 0)
      return send(res, 409, { error: "already_member", id: `usr_${known + 1}`, active: false });
    memberInvites.push(body);
    return send(res, 201, {
      id: `usr_${memberInvites.length}`,
      email: body.email,
      emailSent: true,
    });
  }
  const resend = /^\/api\/lead-id\/v1\/members\/([^/]+)\/invite$/.exec(url.pathname);
  if (resend && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${MEMBERS_TOKEN}`)
      return send(res, 401, { error: "invalid_token" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!inviterProven(req, body)) return send(res, 403, { error: "inviter_proof" });
    memberResends.push({ id: decodeURIComponent(resend[1]), ...body });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/test/member-invites")
    return send(res, 200, { invites: memberInvites, resends: memberResends });

  if (url.pathname === "/test/revoke-refresh" && req.method === "POST") {
    const { sub } = JSON.parse((await readBody(req)) || "{}");
    for (const [token, held] of refreshTokens)
      if ((held.user ?? held).sub === sub) refreshTokens.delete(token);
    return send(res, 200, { ok: true });
  }
  // Départ d'une personne (comme ERPlead, « disabled ») : toutes ses sessions du Compte Lead et tous ses
  // jetons tombent, et l'application reçoit un logout_token sans sid (toutes ses sessions, partout).
  if (url.pathname === "/test/disable" && req.method === "POST") {
    const { sub, org } = JSON.parse((await readBody(req)) || "{}");
    for (const [token, held] of refreshTokens)
      if ((held.user ?? held).sub === sub) refreshTokens.delete(token);
    for (const [sid, u] of leadSessions) if (u.sub === sub) leadSessions.delete(sid);
    const status = await backchannel({ sub, org, lead_status: "disabled" });
    return send(res, 200, { ok: true, status });
  }
  if (url.pathname === "/test/backchannels") return send(res, 200, backchannels);
  if (url.pathname === "/test/refreshes") return send(res, 200, { refreshes });

  if (url.pathname === "/test/next-user" && req.method === "POST") {
    nextUser = { ...defaultUser, ...JSON.parse((await readBody(req)) || "{}") };
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/resend/emails" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer re_test") return send(res, 401, { error: "key" });
    const mail = JSON.parse((await readBody(req)) || "{}");
    emails.push(mail);
    return send(res, 200, { id: `em_${emails.length}` });
  }
  if (url.pathname === "/test/emails") return send(res, 200, emails);

  // Faux récepteur de webhooks : garde les en-têtes et le corps reçus.
  if (url.pathname === "/hooks" && req.method === "POST") {
    hooks.push({ headers: req.headers, body: await readBody(req) });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/test/hooks") return send(res, 200, hooks);

  // Faux cours BCE (Frankfurter) : base EUR, le franc bouge d'un millième par jour du mois, pour
  // qu'un paiement reçu plus tard produise une différence de change.
  const fx = /^\/fx\/v1\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
  if (fx) {
    const day = Number(fx[1].slice(8, 10));
    const eur = { EUR: 1, CHF: 0.94 + (day - 1) / 1000, USD: 1.1, GBP: 0.85 };
    const base = url.searchParams.get("base") ?? "EUR";
    const to = url.searchParams.get("symbols") ?? "CHF";
    if (!(base in eur) || !(to in eur)) return send(res, 404, { message: "not found" });
    const rate = Math.round((eur[to] / eur[base]) * 1e5) / 1e5;
    return send(res, 200, { amount: 1, base, date: fx[1], rates: { [to]: rate } });
  }

  // Faux Stripe : autorisation Connect (acceptée d'office), échange du code, sessions Checkout.
  if (url.pathname === "/stripe-connect/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "/");
    back.searchParams.set("code", "ac_test");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/stripe-connect/oauth/token" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer sk_test_e2e") return send(res, 401, { error: "key" });
    return send(res, 200, { stripe_user_id: "acct_e2e", livemode: false });
  }
  if (url.pathname === "/stripe/v1/checkout/sessions" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer sk_test_e2e") return send(res, 401, { error: "key" });
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const id = `cs_test_${Date.now()}_${checkouts.length + 1}`;
    checkouts.push({ id, account: req.headers["stripe-account"], form });
    return send(res, 200, { id, url: `http://localhost:${PORT}/stripe/checkout/${id}` });
  }
  if (url.pathname.startsWith("/stripe/checkout/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><title>Stripe Checkout</title><h1>Stripe Checkout (test)</h1>");
  }
  if (url.pathname === "/test/checkouts") return send(res, 200, checkouts);

  if (url.pathname === "/ai/chat/completions" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer ai_test") return send(res, 401, { error: "key" });
    const body = JSON.parse((await readBody(req)) || "{}");
    const system = String(body.messages?.[0]?.content ?? "");
    if (system.includes("bookkeeping assistant of InvoiceLead")) {
      // Assistant : le faux modèle répond avec les chiffres reçus, comme le vrai doit le faire.
      const { facts } = JSON.parse(String(body.messages?.[1]?.content ?? "{}"));
      const answer = `Vos clients vous doivent ${facts.company.currency} ${facts.receivables.openTotal.toFixed(2)}, dont ${facts.receivables.overdueTotal.toFixed(2)} en retard.`;
      return send(res, 200, {
        choices: [
          { message: { content: JSON.stringify({ answer, links: ["invoices", "nope"] }) } },
        ],
      });
    }
    if (system.includes("receipts")) {
      // Lecture de justificatif : le faux modèle relit le montant et le fournisseur dans le texte.
      const text = String(body.messages?.[1]?.content ?? "");
      const total = /Total CHF ([\d.]+)/.exec(text)?.[1] ?? null;
      const answer = {
        supplier: text.split("\n")[0]?.trim() || null,
        date: /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null,
        total,
        currency: "CHF",
        vat: null,
        vat_code: null,
        invoice_number: "F-1",
        description: "Frais de tenue de compte",
        account: "6940",
        confidence: 0.95,
      };
      return send(res, 200, { choices: [{ message: { content: JSON.stringify(answer) } }] });
    }
    const payload = JSON.parse(body.messages?.[1]?.content ?? "{}");
    const results = (payload.transactions ?? []).map((t) =>
      t.direction === "out"
        ? {
            id: t.id,
            account: "6940",
            vat: null,
            confidence: 0.95,
            explanation: "Frais bancaires.",
          }
        : { id: t.id, account: null, vat: null, confidence: 0.2, explanation: "Inconnu." },
    );
    return send(res, 200, { choices: [{ message: { content: JSON.stringify({ results }) } }] });
  }

  // ERPlead par application : l'abonnement déclaré par InvoiceLead donne la formule d'InvoiceLead.
  if (url.pathname === "/api/lead-id/v1/subscriptions" && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${BILLING_TOKEN}`)
      return send(res, 401, { error: "invalid_token" });
    const body = JSON.parse((await readBody(req)) || "{}");
    billingReports.push(body);
    const granting = ["active", "trialing", "past_due"].includes(body.status);
    const plan = granting ? (PLAN_ROWS[body.plan] ?? PLAN_ROWS.free) : PLAN_ROWS.free;
    return send(res, 200, {
      org: body.org,
      app: "invoicelead",
      plan: { ...plan, source: granting ? "own" : "free", valid_until: null },
      apps: {
        invoicelead: {
          access: true,
          name: "InvoiceLead",
          url: "http://localhost:3100",
          status: "live",
          upgrade_url: "http://localhost:3100/fr/app/settings/plan",
        },
      },
      subscriptions: [],
    });
  }
  if (url.pathname === "/test/billing-reports") return send(res, 200, billingReports);

  // Faux Stripe de l'abonnement (distinct de Stripe Connect ci-dessus : autre clé, autre adresse).
  if (url.pathname.startsWith("/stripe-billing/v1/")) {
    if (req.headers.authorization !== BILLING_KEY)
      return send(res, 401, { error: { message: "key" } });
    const path = url.pathname.slice("/stripe-billing".length);
    const form = req.method === "POST" ? new URLSearchParams(await readBody(req)) : null;
    const meta = (prefix) => {
      const out = {};
      for (const [k, v] of form?.entries() ?? []) {
        const m = new RegExp(`^${prefix.replace(/[[\]]/g, "\\$&")}\\[([^\\]]+)\\]$`).exec(k);
        if (m) out[m[1]] = v;
      }
      return out;
    };
    if (path === "/v1/customers" && req.method === "POST") {
      const id = `cus_e2e_${STARTED}_${billing.customers.length + 1}`;
      billing.customers.push({
        id,
        idempotency: req.headers["idempotency-key"],
        form: Object.fromEntries(form),
      });
      return send(res, 200, { id });
    }
    if (path === "/v1/checkout/sessions" && req.method === "POST") {
      const id = `cs_test_e2e_${Date.now()}_${billing.checkouts.length + 1}`;
      const session = {
        id,
        mode: form.get("mode"),
        status: "open",
        customer: form.get("customer"),
        subscription: null,
        metadata: meta("metadata"),
        subscription_metadata: meta("subscription_data[metadata]"),
        price: form.get("line_items[0][price]"),
        success_url: form.get("success_url"),
        cancel_url: form.get("cancel_url"),
        form: Object.fromEntries(form),
      };
      billing.checkouts.push(session);
      return send(res, 200, { id, url: `${ISSUER}/stripe-billing/checkout/${id}` });
    }
    const cs = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path);
    if (cs && req.method === "GET") {
      const found = billing.checkouts.find((c) => c.id === decodeURIComponent(cs[1]));
      if (!found) return send(res, 404, { error: { message: "No such checkout session" } });
      const { form: _f, subscription_metadata: _m, price: _p, ...session } = found;
      return send(res, 200, session);
    }
    const sub = /^\/v1\/subscriptions\/([^/]+)$/.exec(path);
    if (sub && req.method === "GET") {
      const found = billing.subscriptions.get(decodeURIComponent(sub[1]));
      return found
        ? send(res, 200, found)
        : send(res, 404, { error: { code: "resource_missing", message: "No such subscription" } });
    }
    if (path === "/v1/billing_portal/sessions" && req.method === "POST") {
      const n = billing.portals.length + 1;
      billing.portals.push(Object.fromEntries(form));
      return send(res, 200, { url: `${ISSUER}/stripe-billing/portal/${n}` });
    }
    return send(res, 400, { error: { message: `inconnu : ${req.method} ${path}` } });
  }
  // « Paiement » d'une session : l'abonnement naît, la session est terminée, retour à InvoiceLead.
  const pay = /^\/stripe-billing\/checkout\/([^/]+)$/.exec(url.pathname);
  if (pay) {
    const session = billing.checkouts.find((c) => c.id === decodeURIComponent(pay[1]));
    if (!session) return send(res, 404, { error: "session" });
    if (url.searchParams.get("cancel") === "1") {
      res.writeHead(303, { Location: session.cancel_url });
      return res.end();
    }
    if (url.searchParams.get("pay") !== "1") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        `<!doctype html><title>Stripe Checkout</title><h1>Stripe Checkout (test)</h1><a href="?pay=1">Payer</a> <a href="?cancel=1">Annuler</a>`,
      );
    }
    if (!session.subscription) {
      const id = `sub_e2e_${STARTED}_${billing.subscriptions.size + 1}`;
      const yearly = /yearly|_y$/.test(session.price ?? "");
      billing.subscriptions.set(id, {
        id,
        object: "subscription",
        customer: session.customer,
        status: "active",
        livemode: false,
        cancel_at_period_end: false,
        metadata: session.subscription_metadata,
        items: {
          data: [
            {
              current_period_end: Math.floor(Date.now() / 1000) + (yearly ? 365 : 30) * 86_400,
              price: { id: session.price, recurring: { interval: yearly ? "year" : "month" } },
            },
          ],
        },
      });
      session.subscription = id;
      session.status = "complete";
    }
    res.writeHead(303, {
      Location: session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id),
    });
    return res.end();
  }
  if (/^\/stripe-billing\/portal\/\d+$/.test(url.pathname)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      "<!doctype html><title>Portail</title><h1>Portail client InvoiceLead (test)</h1>",
    );
  }
  if (url.pathname === "/test/billing")
    return send(res, 200, { ...billing, subscriptions: [...billing.subscriptions.values()] });
  const change = /^\/test\/billing\/subscriptions\/([^/]+)$/.exec(url.pathname);
  if (change && req.method === "POST") {
    const found = billing.subscriptions.get(decodeURIComponent(change[1]));
    if (!found) return send(res, 404, { error: "subscription" });
    Object.assign(found, JSON.parse((await readBody(req)) || "{}"));
    return send(res, 200, found);
  }

  if (url.pathname === "/test/logouts") return send(res, 200, logouts);
  if (url.pathname === "/test/authorizes") return send(res, 200, authorizes);
  if (url.pathname === "/health") return send(res, 200, { ok: true });

  send(res, 404, { error: "not_found" });
}).listen(PORT, () => console.log(`fake lead id on ${ISSUER}`));
