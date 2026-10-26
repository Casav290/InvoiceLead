/**
 * Kit « compte Lead » pour les applications de la famille (Scanlead, ProjectLead, InvoiceLead…).
 *
 * Un seul fichier, aucune dépendance : Node 18 ou plus (fetch et crypto intégrés). À copier tel
 * quel dans le serveur de l'application (ex. `server/leadId.ts`). Mode d'emploi : LEAD-ID.md.
 *
 * Copie de CRMlead `docs/lead-id-kit/leadId.ts` au 30.09.2026. Ajouts propres à InvoiceLead depuis :
 * `@ts-nocheck` ci-dessous (ce dépôt compile avec `noUncheckedIndexedAccess`, plus strict que CRMlead),
 * `sid` de la session du Compte Lead, relecture des clés pour un `kid` inconnu limitée à une toutes
 * les 30 s (comme ScanLead `server/leadId.ts`), et depuis le 26.10.2026 la « liaison sans clé » :
 * jeton d'échange lié à l'organisation (et à la personne), réception d'ERPlead seul, contrôle de
 * l'enveloppe (zod, la seule dépendance). Plus d'émetteur de transition crmlead.io.
 *
 * Variables d'environnement attendues :
 *   LEAD_ID_ISSUER         https://erplead.io
 *   LEAD_ID_CLIENT_ID      scanlead
 *   LEAD_ID_CLIENT_SECRET  lid_…   (Réglages CRMlead → Mon compte Lead → Applications reliées)
 *   LEAD_ID_REDIRECT_URI   https://scanlead.io/auth/lead/callback
 *   LEAD_ID_APP            scanlead  (le code de l'application dans la famille)
 */
// @ts-nocheck
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { z } from 'zod'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} manquant`)
  return v
}
const issuer = () => env('LEAD_ID_ISSUER').replace(/\/+$/, '')
const b64url = (b: Buffer) => b.toString('base64url')
const basic = () => 'Basic ' + Buffer.from(`${encodeURIComponent(env('LEAD_ID_CLIENT_ID'))}:${encodeURIComponent(env('LEAD_ID_CLIENT_SECRET'))}`).toString('base64')

// ------------------------------------------------------------------ types

/** Ce que le compte Lead dit d'une personne (jeton d'identité, ou /oauth/userinfo). */
export type LeadClaims = {
  sub: string                       // identifiant stable de la personne : c'est LUI qui rattache, pas l'email
  email: string; email_verified: boolean
  name: string; locale: string; zoneinfo: string
  org: string; org_name: string; org_role: 'admin' | 'manager' | 'user'
  lead: LeadEntitlements
  /** Session du Compte Lead (un navigateur) qui a donné ce jeton : la déconnexion ne ferme qu'elle. */
  sid?: string
}

/** Le `sid` d'un jeton du Compte Lead, s'il est utilisable (1 à 255 caractères), sinon null. */
export function leadSidOf(claims: { sid?: unknown } | null | undefined): string | null {
  const sid = claims?.sid
  return typeof sid === 'string' && sid.length > 0 && sid.length <= 255 ? sid : null
}
export type LeadEntitlements = {
  plan: { code: 'free' | 'pro' | 'pro_plus' | string; name: string; rank: number; seats: number | null }
  apps: Record<string, { access: boolean; name: string; url: string | null; status: string; upgrade_url: string | null; [limit: string]: unknown }>
  subscriptions: { app: string; plan: string; lead_plan: string | null; status: string; current_period_end: string | null }[]
}
export type LoginStart = { url: string; state: string; nonce: string; verifier: string; maxAge?: number }
export type Tokens = { access_token: string; id_token: string; refresh_token?: string; expires_in: number; scope: string }

// ------------------------------------------------------------------ clés publiques

const jwksCache = new Map<string, { at: number; keys: any[] }>()
// Relecture pour une clé inconnue : au plus une toutes les 30 s par émetteur (même règle que ScanLead, 14.10.2026).
// La route back-channel et la boîte de réception des échanges sont publiques : sans ce délai, chaque jeton forgé avec
// un `kid` inventé ferait un appel à ERPlead (amplificateur 1 pour 1). Une vraie rotation de clé est prise en compte
// dans les 30 s. Les requêtes simultanées partagent la même lecture, qu'elle vienne de l'expiration d'une heure ou d'une
// clé inconnue : une requête qui trouve une lecture en cours l'attend avant de conclure. Les émetteurs sont filtrés
// avant d'arriver ici (liste fixe), ces tables ne grandissent donc pas.
const UNKNOWN_KID_REFRESH_MS = 30_000
const jwksReadAt = new Map<string, number>()
const jwksReading = new Map<string, Promise<void>>()
function readJwks(iss: string): Promise<void> {
  jwksReadAt.set(iss, Date.now())
  let reading = jwksReading.get(iss)
  if (!reading) {
    // `.finally` s'exécute toujours après coup : la lecture est inscrite avant d'être retirée, même en cas d'échec immédiat.
    reading = (async () => {
      const r = await fetch(`${iss}/oauth/jwks`)
      if (!r.ok) throw new Error(`jwks ${r.status}`)
      jwksCache.set(iss, { at: Date.now(), keys: (await r.json()).keys })
    })().finally(() => { jwksReading.delete(iss) })
    jwksReading.set(iss, reading)
  }
  return reading
}
/** Temps écoulé depuis `at` ; une horloge revenue en arrière compte comme « très ancien ». */
const elapsed = (at: number) => { const d = Date.now() - at; return d < 0 ? Infinity : d }
async function publicKey(kid: string, iss: string = issuer()) {
  const hit = jwksCache.get(iss)
  if (!hit || elapsed(hit.at) > 3_600_000) await readJwks(iss)
  let jwk = jwksCache.get(iss)!.keys.find((k) => k.kid === kid)
  // Clé inconnue : le compte Lead a peut-être tourné sa clé, on relit (pas plus d'une fois toutes les 30 s par émetteur).
  // Une relecture déjà en cours (lancée par une autre requête, dont `jwksReadAt` vient d'être posé) est attendue avant
  // de conclure, sans nouvel appel : sinon, juste après une rotation, de deux jetons légitimes arrivés ensemble seul
  // le premier serait accepté (connexion refusée, ou déconnexion back-channel en 400 et session laissée ouverte).
  const pending = jwksReading.get(iss)
  if (!jwk && (pending || elapsed(jwksReadAt.get(iss) ?? -Infinity) >= UNKNOWN_KID_REFRESH_MS)) {
    await (pending ?? readJwks(iss))
    jwk = jwksCache.get(iss)!.keys.find((k) => k.kid === kid)
  }
  return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null
}

/**
 * Vérifie un JWT du compte Lead : signature RS256, émetteur, audience, expiration.
 * Rend les revendications, ou `null`. Ne jamais lire un jeton sans passer par ici.
 */
export async function verifyLeadJwt(token: string, audience: string, issuers: string[] = [issuer()]): Promise<Record<string, any> | null> {
  try {
    const [h, p, s] = token.split('.')
    const head = JSON.parse(Buffer.from(h, 'base64url').toString())
    if (head.alg !== 'RS256') return null
    // L'émetteur annoncé choisit la clé, mais seulement parmi ceux qu'on accepte ; la signature le confirme.
    const iss = String(JSON.parse(Buffer.from(p, 'base64url').toString()).iss ?? '')
    if (!issuers.includes(iss)) return null
    const key = await publicKey(head.kid, iss)
    if (!key || !verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null
    const c = JSON.parse(Buffer.from(p, 'base64url').toString())
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (!issuers.includes(c.iss) || !aud.includes(audience) || typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 30_000) return null
    return c
  } catch { return null }
}

// ------------------------------------------------------------------ connexion

/**
 * Étape 1 : l'adresse où envoyer la personne. Garder `state`, `nonce` et `verifier` côté
 * serveur (cookie httpOnly signé ou session) jusqu'au retour : ils prouvent que le retour est le sien.
 */
export function startLogin(opts: { prompt?: 'none' | 'login' | 'create'; locale?: string; maxAge?: number; app?: boolean } = {}): LoginStart {
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(24))
  const nonce = b64url(randomBytes(24))
  const q = new URLSearchParams({
    response_type: 'code', client_id: env('LEAD_ID_CLIENT_ID'), redirect_uri: env('LEAD_ID_REDIRECT_URI'),
    scope: 'openid email profile lead offline_access', state, nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  })
  // prompt=create : ouvrir l'inscription plutôt que la connexion (OIDC, « Initiating User Registration »).
  // prompt=login : redemander le mot de passe (avant une action sensible). maxAge : exiger une
  // connexion de moins de N secondes ; `finishLogin` le vérifie sur `auth_time`.
  if (opts.prompt) q.set('prompt', opts.prompt)
  if (opts.maxAge != null) q.set('max_age', String(opts.maxAge))
  if (opts.locale) q.set('ui_locales', opts.locale)
  // Depuis l'app Android / iOS : le Compte Lead n'y montre pas « Continuer avec Google » (refusé par
  // Google dans une vue web, et Apple exigerait alors « Se connecter avec Apple », règle 4.8).
  if (opts.app) q.set('platform', 'app')
  return { url: `${issuer()}/oauth/authorize?${q}`, state, nonce, verifier, ...(opts.maxAge != null ? { maxAge: opts.maxAge } : {}) }
}

/** Étape 2 : au retour, le code contre les jetons ; le jeton d'identité est vérifié ici. */
export async function finishLogin(query: { code?: string; state?: string; error?: string },
                                  saved: { state: string; nonce: string; verifier: string; maxAge?: number }) {
  if (query.error) throw new Error(`lead_id:${query.error}`)
  if (!query.code || !query.state || query.state !== saved.state) throw new Error('lead_id:state_mismatch')
  const tokens = await tokenRequest({
    grant_type: 'authorization_code', code: query.code,
    redirect_uri: env('LEAD_ID_REDIRECT_URI'), code_verifier: saved.verifier,
  })
  const claims = await verifyLeadJwt(tokens.id_token, env('LEAD_ID_CLIENT_ID'))
  if (!claims || claims.nonce !== saved.nonce) throw new Error('lead_id:invalid_id_token')
  if (saved.maxAge != null && (typeof claims.auth_time !== 'number' || Date.now() / 1000 - claims.auth_time > saved.maxAge + 60)) {
    throw new Error('lead_id:auth_too_old')
  }
  return { claims: claims as LeadClaims, tokens }
}

/** Nouveau jeton d'accès (et droits à jour) sans redemander la connexion. Le jeton de rafraîchissement tourne : garder le nouveau. */
export async function refresh(refreshToken: string) {
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  const claims = await verifyLeadJwt(tokens.id_token, env('LEAD_ID_CLIENT_ID'))
  if (!claims) throw new Error('lead_id:invalid_id_token')
  return { claims: claims as LeadClaims, tokens }
}

/** L'adresse de déconnexion : ferme aussi la session du compte Lead, puis revient chez vous. */
export function logoutUrl(idToken: string | null, backTo: string) {
  const q = new URLSearchParams({ client_id: env('LEAD_ID_CLIENT_ID'), post_logout_redirect_uri: backTo })
  if (idToken) q.set('id_token_hint', idToken)
  return `${issuer()}/oauth/logout?${q}`
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${issuer()}/oauth/token`, {
    method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`lead_id:${out.error ?? r.status}`)
  return out
}

// ------------------------------------------------------------------ d'application à application

const appTokens = new Map<string, { token: string; until: number }>()

/**
 * Jeton d'application `billing` (droits et abonnements de n'importe quelle organisation), mis en cache.
 * Les échanges entre applications passent par `exchangeToken`, lié à une organisation.
 */
export async function appToken(scope: 'billing') {
  const key = scope
  const hit = appTokens.get(key)
  if (hit && hit.until > Date.now() + 60_000) return hit.token
  const t = await tokenRequest({ grant_type: 'client_credentials', scope })
  appTokens.set(key, { token: t.access_token, until: Date.now() + t.expires_in * 1000 })
  return t.access_token
}

/**
 * Déclarer un abonnement encaissé ici (webhook Stripe, RevenueCat…). À appeler à CHAQUE
 * changement : création, changement de formule, échec de paiement, résiliation.
 * `plan` = le nom de la formule DANS VOTRE APPLICATION (ex. Scanlead : free, solo, team).
 */
export async function reportSubscription(s: {
  org?: string; email?: string; external_id: string; plan: string
  status: 'active' | 'trialing' | 'on_trial' | 'past_due' | 'canceled' | 'expired' | 'paused' | 'incomplete' | string
  current_period_end?: string | Date | null
}): Promise<LeadEntitlements & { org: string }> {
  const r = await fetch(`${issuer()}/api/lead-id/v1/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken('billing')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`lead_id:${out.error ?? r.status}`)
  return out
}

/** Les droits d'une organisation, à jour (la formule a pu changer depuis la connexion). */
export async function entitlementsOf(q: { org?: string; email?: string }): Promise<LeadEntitlements & { org: string }> {
  const r = await fetch(`${issuer()}/api/lead-id/v1/entitlements?${new URLSearchParams(q as Record<string, string>)}`,
    { headers: { Authorization: `Bearer ${await appToken('billing')}` } })
  if (!r.ok) throw new Error(`lead_id:${r.status}`)
  return r.json()
}

// ------------------------------------------------------------------ échange de données (liaison sans clé)

export type Envelope = {
  id: string                        // identifiant unique de l'envoi (uuid)
  type: 'contact' | 'lead' | 'deal' | 'client' | 'document' | 'invoice' | string
  org: string                       // l'organisation ERPlead (claims.org)
  sub?: string                      // la personne qui a agi (claims.sub), si connue
  occurred_at: string
  source: { app: string; id: string; url?: string }   // votre application et VOTRE identifiant de l'objet
  data: Record<string, unknown>
}

/** Erreur d'un échange : `status` HTTP (0 : ERPlead ou l'app sœur injoignable) et corps JSON rendu. */
export type ExchangeError = Error & { status: number; body: Record<string, unknown> }
const exchangeError = (code: string, status: number, body: Record<string, unknown> = {}): ExchangeError =>
  Object.assign(new Error(code), { status, body })

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** Jetons d'échange : 14 min sans personne, 5 min avec (et jamais au-delà de leur expiration). */
const ORG_TOKEN_MS = 14 * 60_000
const PERSON_TOKEN_MS = 5 * 60_000
const exchangeTokens = new Map<string, { token: string; until: number }>()
const tokenKey = (scope: string, audience: string, org: string, proof?: string | null) =>
  `${scope}|${audience}|${org}|${proof ? sha256(proof) : ''}`

/**
 * Jeton d'échange d'ERPlead pour UNE application cible et UNE organisation, avec la preuve de la
 * personne (son jeton d'identité) quand elle agit. Aucune formule n'est regardée par ERPlead.
 * ERPlead en panne (5xx, réseau) : erreur `erplead_unavailable` (à relancer) ; refus (4xx) : erreur
 * portant `status` et `body` (invalid_target, person_proof, test_org_only…).
 */
export async function exchangeToken(scope: 'exchange' | 'exchange_read', audience: string,
                                    opts: { org: string; personProof?: string | null }): Promise<string> {
  if (!opts.org) throw exchangeError('org_required', 400, { error: 'org_required' })
  const key = tokenKey(scope, audience, opts.org, opts.personProof)
  const hit = exchangeTokens.get(key)
  if (hit && hit.until > Date.now()) return hit.token
  const form: Record<string, string> = { grant_type: 'client_credentials', scope, audience, org: opts.org }
  if (opts.personProof) {
    form.subject_token = opts.personProof
    form.subject_token_type = 'urn:ietf:params:oauth:token-type:id_token'
  }
  let r: Response
  try {
    r = await fetch(`${issuer()}/oauth/token`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    })
  } catch {
    throw exchangeError('erplead_unavailable', 0, { error: 'erplead_unavailable' })
  }
  const out = await r.json().catch(() => ({}))
  if (r.status >= 500) throw exchangeError('erplead_unavailable', r.status, { error: 'erplead_unavailable' })
  if (!r.ok || typeof out.access_token !== 'string') throw exchangeError(`lead_id:${out.error ?? r.status}`, r.status, out)
  const life = Math.min((Number(out.expires_in) || 900) * 1000 - 60_000, opts.personProof ? PERSON_TOKEN_MS : ORG_TOKEN_MS)
  exchangeTokens.set(key, { token: out.access_token, until: Date.now() + Math.max(life, 0) })
  return out.access_token
}

/** Oublie un jeton d'échange (refusé en 401 par la cible) ; sans argument, tous (tests). */
export function forgetExchangeToken(scope?: string, audience?: string, org?: string, proof?: string | null) {
  if (scope === undefined) exchangeTokens.clear()
  else exchangeTokens.delete(tokenKey(scope, audience ?? '', org ?? '', proof))
}

/** Même origine (schéma, hôte, port) ; une adresse invalide n'est jamais la même. */
export function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin } catch { return false }
}

/**
 * Carte de visite d'une application sœur (`/.well-known/lead-app.json`). Les adresses qu'elle donne
 * ne sont gardées que si elles sont sur la même origine que l'adresse constante de l'app.
 */
async function cardOf(baseUrl: string): Promise<{ inbox?: string; read?: string }> {
  const base = baseUrl.replace(/\/+$/, '')
  let r: Response
  try { r = await fetch(`${base}/.well-known/lead-app.json`, { redirect: 'error' }) } catch {
    throw exchangeError('lead_app_unavailable', 0, { error: 'lead_app_unavailable' })
  }
  if (!r.ok) throw exchangeError(`lead_app ${r.status}`, r.status >= 500 ? r.status : 0, { error: 'lead_app_card' })
  const exchange = (await r.json().catch(() => ({})))?.exchange ?? {}
  const keep = (u: unknown) => (typeof u === 'string' && sameOrigin(u, base) ? u : undefined)
  return { inbox: keep(exchange.inbox), read: keep(exchange.read) }
}

/** Appel avec un jeton d'échange : 401 → jeton oublié, une seule nouvelle tentative. */
async function withExchangeToken(scope: 'exchange' | 'exchange_read', audience: string, org: string,
                                 proof: string | null | undefined, call: (token: string) => Promise<Response>) {
  let r: Response
  try {
    r = await call(await exchangeToken(scope, audience, { org, personProof: proof }))
    if (r.status === 401) {
      forgetExchangeToken(scope, audience, org, proof)
      r = await call(await exchangeToken(scope, audience, { org, personProof: proof }))
    }
  } catch (e) {
    if ((e as ExchangeError).body) throw e
    throw exchangeError('lead_app_unavailable', 0, { error: 'lead_app_unavailable' })
  }
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw exchangeError(`lead_exchange:${out.error ?? r.status}`, r.status, out)
  return out
}

/**
 * Envoyer un objet à une application sœur, pour l'organisation de l'enveloppe. Répéter le même
 * `source.id` met à jour chez elle, sans doublon : on peut renvoyer sans crainte après un échec.
 * Erreur : `status` et `body` de la réponse (0 : injoignable).
 */
export async function send(target: { app: string; url: string },
                           e: Omit<Envelope, 'id' | 'occurred_at' | 'source'> & { id?: string; occurred_at?: string; source: { id: string; url?: string } },
                           opts: { personProof?: string | null } = {}) {
  const envelope: Envelope = {
    id: crypto.randomUUID(), occurred_at: new Date().toISOString(), ...e,
    source: { app: env('LEAD_ID_APP'), ...e.source },
  }
  const { inbox } = await cardOf(target.url)
  if (!inbox) throw exchangeError('lead_app_no_inbox', 0, { error: 'lead_app_no_inbox' })
  return withExchangeToken('exchange', target.app, envelope.org, opts.personProof, (token) => fetch(inbox, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })) as Promise<{ id?: string; url?: string; status: 'created' | 'updated' | string }>
}

/** Lire chez une application sœur (`exchange.read` de sa carte), avec les droits de la personne. */
export async function readExchange(target: { app: string; url: string },
                                   q: { type: string; q?: string; ids?: string[]; link?: boolean },
                                   opts: { org: string; personProof: string }) {
  const { read } = await cardOf(target.url)
  if (!read) throw exchangeError('lead_app_no_read', 0, { error: 'lead_app_no_read' })
  const params = new URLSearchParams({ type: q.type })
  if (q.q) params.set('q', q.q)
  if (q.ids?.length) params.set('ids', q.ids.join(','))
  if (q.link) params.set('link', '1')
  return withExchangeToken('exchange_read', target.app, opts.org, opts.personProof, (token) =>
    fetch(`${read}?${params}`, { redirect: 'error', headers: { Authorization: `Bearer ${token}` } }))
}

export type IncomingExchange = { app: string; org: string | null; person: string | null; person_role: string | null }

/**
 * Côté réception : qui envoie, pour quelle organisation, au nom de quelle personne ? Jeton signé par
 * ERPlead seulement, destiné à cette application (`aud`), émis pour un client (`sub` « client:… »).
 * Jeton d'échange (`token_use` 'exchange') : portée exactement `want`. Ancien jeton sans organisation :
 * accepté seulement en envoi (`want` 'exchange'), sans organisation ni personne. Sinon `null`.
 */
export async function incomingExchange(authorization: string | null | undefined,
                                       want: 'exchange' | 'exchange_read'): Promise<IncomingExchange | null> {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i)
  if (!m) return null
  const c = await verifyLeadJwt(m[1], env('LEAD_ID_APP'), [issuer()])
  if (!c || typeof c.sub !== 'string' || !c.sub.startsWith('client:')) return null
  const app = typeof c.app === 'string' && c.app ? c.app : null
  if (!app) return null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (c.token_use === 'exchange') {
    if (c.scope !== want) return null
    return { app, org: str(c.org), person: str(c.person), person_role: str(c.person_role) }
  }
  if (want === 'exchange' && String(c.scope ?? '').split(' ').includes('exchange')) {
    return { app, org: null, person: null, person_role: null }
  }
  return null
}

/** Chaînes ≤ 2000, `contacts` ≤ 50, `lines` ≤ 200, tout autre tableau ≤ 200, profondeur ≤ 6. */
function withinLimits(v: unknown, key = '', depth = 0): boolean {
  if (depth > 6) return false
  if (typeof v === 'string') return v.length <= 2000
  if (Array.isArray(v)) {
    const max = key === 'contacts' ? 50 : 200
    return v.length <= max && v.every((x) => withinLimits(x, '', depth + 1))
  }
  if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => withinLimits(x, k, depth + 1))
  return true
}
const short = z.string().min(1).max(2000)
export const envelopeSchema = z.object({
  id: short,
  type: short,
  org: short,
  sub: z.string().max(2000).nullish(),
  occurred_at: z.string().max(2000).optional(),
  source: z.object({ app: short, id: short, url: z.string().max(2000).optional() }),
  data: z.record(z.string(), z.unknown()).refine((d) => withinLimits(d), 'limits'),
})

/**
 * Contrôle d'une enveloppe reçue, après `incomingExchange`. Rend `null` si elle passe, sinon le refus :
 * 400 invalid_envelope, 422 unsupported_type, 403 source_mismatch / sender_not_allowed / org_mismatch,
 * 401 org_required (jeton sans organisation d'un expéditeur de `orgSenders`).
 */
export function checkEnvelope(tok: IncomingExchange, e: unknown, allowed: Record<string, string[]>,
                              orgSenders: string[]): { status: number; error: string } | null {
  const parsed = envelopeSchema.safeParse(e)
  if (!parsed.success) return { status: 400, error: 'invalid_envelope' }
  const env = parsed.data
  if (!Object.hasOwn(allowed, env.type)) return { status: 422, error: 'unsupported_type' }
  if (env.source.app !== tok.app) return { status: 403, error: 'source_mismatch' }
  if (!allowed[env.type].includes(tok.app)) return { status: 403, error: 'sender_not_allowed' }
  if (tok.org && tok.org !== env.org) return { status: 403, error: 'org_mismatch' }
  if (!tok.org && orgSenders.includes(tok.app)) return { status: 401, error: 'org_required' }
  return null
}

/** Liste EXCHANGE_ORG_SENDERS (séparée par des virgules), ou le défaut de l'application. */
export function orgSendersFrom(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean)
}
