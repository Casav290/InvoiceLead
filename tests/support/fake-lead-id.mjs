/**
 * Faux Compte Lead pour les tests de bout en bout : un émetteur OpenID Connect minimal qui signe
 * pour de bon (RS256) et vérifie PKCE, l'adresse de retour et le secret du client. Sans cela, les
 * tests ne prouveraient rien du branchement réel (même principe que les faux fournisseurs de CRMlead).
 *
 *   node tests/support/fake-lead-id.mjs            (port 4010)
 *   POST /test/next-user  {sub,email,name,org,org_name,org_role,access,plan}  choisit la prochaine personne
 *   POST /resend/emails   imite l'API d'envoi de Resend (clé « re_test ») ; GET /test/emails les relit
 *   POST /ai/chat/completions  faux assistant comptable : chaque sortie d'argent va en frais bancaires
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
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
const logouts = [];

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

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** Sessions Checkout créées, pour les tests. */
const checkouts = [];

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
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
    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      user: nextUser,
      nonce: q.get("nonce"),
      challenge: q.get("code_challenge"),
      at: Date.now(),
    });
    nextUser = { ...defaultUser };
    const back = new URL(REDIRECT_URI);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { Location: back.toString() });
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

    const u = entry.user;
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: u.sub,
      iat: now,
      exp: now + 600,
      auth_time: now,
      nonce: entry.nonce,
      email: u.email,
      email_verified: true,
      name: u.name,
      locale: "fr",
      zoneinfo: "Europe/Zurich",
      org: u.org,
      org_name: u.org_name,
      org_role: u.org_role,
      lead: {
        plan:
          u.plan === "pro"
            ? { code: "pro", name: "Pro", rank: 1, seats: 2 }
            : { code: "free", name: "Gratuit", rank: 0, seats: 1 },
        apps: {
          scanlead: {
            access: true,
            name: "Scanlead",
            url: "https://scanlead.io",
            status: "live",
            upgrade_url: "https://scanlead.io/billing",
          },
          crmlead: {
            access: true,
            name: "CRMlead",
            url: "https://crmlead.io",
            status: "live",
            upgrade_url: "https://scanlead.io/billing",
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
            status: "live",
            upgrade_url: "https://scanlead.io/billing",
          },
        },
        subscriptions: [],
      },
    });
    return send(res, 200, {
      access_token: randomBytes(16).toString("hex"),
      id_token: idToken,
      refresh_token: randomBytes(16).toString("hex"),
      expires_in: 600,
      scope: "openid email profile lead offline_access",
      token_type: "Bearer",
    });
  }

  if (url.pathname === "/oauth/logout") {
    logouts.push({ client_id: q.get("client_id"), id_token_hint: q.get("id_token_hint") });
    res.writeHead(302, { Location: q.get("post_logout_redirect_uri") ?? "/" });
    return res.end();
  }

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

  if (url.pathname === "/test/logouts") return send(res, 200, logouts);
  if (url.pathname === "/health") return send(res, 200, { ok: true });

  send(res, 404, { error: "not_found" });
}).listen(PORT, () => console.log(`fake lead id on ${ISSUER}`));
