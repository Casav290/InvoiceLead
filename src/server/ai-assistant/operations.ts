import { eq } from "drizzle-orm";
import { z } from "zod";
import { scheduleCrmleadDelivery } from "../crmlead-sync";
import type { Db } from "../db";
import { organizations } from "../db/schema";
import { postPending } from "../ledger";
import { collectEffects } from "../pending-effects";
import { flushWebhooks } from "../webhooks";
import {
  convertQuoteOp,
  createContactOp,
  createDraftOp,
  creditNoteOp,
  depositOp,
  issueDocumentOp,
  quoteOutcomeOp,
  recurringOp,
  recurringStatusOp,
  updateContactOp,
  updateDraftOp,
  waiveChargesOp,
} from "./ops-billing";
import {
  approveBillOp,
  billFromReceiptOp,
  closeYearOp,
  companySettingsOp,
  createAccountOp,
  createBillOp,
  installChartOp,
  openFirstYearOp,
  openNextYearOp,
  postPendingOp,
  readReceiptOp,
  reminderSettingsOp,
  updateAccountOp,
  updateBillOp,
  vatReturnOp,
} from "./ops-books";
import {
  type AssistantContext,
  type BatchItem,
  type ConfirmSummary,
  type Entity,
  fail,
  type Operation,
  type OpOutcome,
  type OpResult,
  type OpSuccess,
  REF_FIELDS,
  rightProblem,
} from "./ops-core";
import {
  createProductOp,
  createProjectOp,
  expenseClaimOp,
  interfaceLanguageOp,
  invoiceProjectOp,
  startTimerOp,
  stopTimerOp,
  timeEntryOp,
  updateProductOp,
  updateProjectOp,
} from "./ops-work";

/**
 * Toutes les écritures que la bulle sait appliquer (inventaire : docs/ASSISTANT-ACTIONS.md). Chacune
 * a son outil `propose_<id>` ; `propose_batch` en regroupe jusqu'à 150 sous une seule carte, un seul
 * clic et une seule transaction (tout ou rien).
 *
 * Proposer = jouer l'opération dans une transaction ANNULÉE (essai à blanc) : mêmes fonctions, mêmes
 * contrôles que la confirmation, et la carte montre ce que la base contiendrait, lu dans cette
 * transaction. Confirmer = la même opération dans une transaction VALIDÉE, après la revérification
 * des droits. Les envois extérieurs déclenchés par une opération (états vers CRMlead, webhooks) ne
 * partent qu'après la validation, jamais d'un essai à blanc.
 */
export const OPERATIONS: Operation[] = [
  createContactOp,
  updateContactOp,
  createDraftOp,
  updateDraftOp,
  issueDocumentOp,
  quoteOutcomeOp,
  convertQuoteOp,
  depositOp,
  creditNoteOp,
  recurringOp,
  recurringStatusOp,
  waiveChargesOp,
  createProductOp,
  updateProductOp,
  createProjectOp,
  updateProjectOp,
  timeEntryOp,
  startTimerOp,
  stopTimerOp,
  invoiceProjectOp,
  expenseClaimOp,
  createBillOp,
  updateBillOp,
  approveBillOp,
  billFromReceiptOp,
  postPendingOp,
  readReceiptOp,
  vatReturnOp,
  createAccountOp,
  updateAccountOp,
  installChartOp,
  openFirstYearOp,
  openNextYearOp,
  closeYearOp,
  companySettingsOp,
  reminderSettingsOp,
  interfaceLanguageOp,
] as Operation[];

export const OPS = new Map(OPERATIONS.map((o) => [o.id, o]));
export const OPERATION_IDS = OPERATIONS.map((o) => o.id);
export const BATCH = "batch";
/** Plafond d'un lot : un plan complet tient dans une carte. */
export const MAX_BATCH = 150;
/** Lignes montrées par groupe sur la carte d'un lot. */
export const GROUP_SHOWN = 5;

/** Outil de la bulle pour une opération. */
export const toolName = (id: string) => `propose_${id}`;

const BATCHABLE = OPERATIONS.filter((o) => o.batch !== false).map((o) => o.id) as [
  string,
  ...string[],
];

export const batchSchema = z.object({
  operations: z
    .array(
      z.object({
        op: z.enum(BATCHABLE).describe("operation, as in the propose_<op> tools"),
        key: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/)
          .optional()
          .describe("local key of what this operation creates, for later operations: @key"),
        input: z
          .record(z.string(), z.unknown())
          .describe("same fields as the matching propose_<op> tool"),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
});
export type BatchInput = z.infer<typeof batchSchema>;

type Json = Record<string, unknown>;
type Item = { op: Operation; input: Json; key?: string };
type Ref = { id: string; entity: Entity };
type Run = { ok: true; outcomes: OpSuccess[] } | { ok: false; error: string; index: number };

const ROLLBACK = new Error("assistant_rollback");

const isRef = (v: unknown): v is string => typeof v === "string" && /^@[A-Za-z]/.test(v);

/** Remplace « @clé » par l'identifiant créé plus haut dans le lot, du bon type. */
function resolveRefs(
  item: Item,
  refs: Map<string, Ref>,
): { ok: true; input: Json } | { ok: false; error: string } {
  const allowed = item.op.refs ?? {};
  const input: Json = { ...item.input };
  const take = (
    value: string,
    entity: Entity,
  ): { ok: true; id: string } | { ok: false; error: string } => {
    const ref = refs.get(value.slice(1));
    if (!ref) return { ok: false, error: `unknown_ref ${value}` };
    if (ref.entity !== entity)
      return { ok: false, error: `ref_kind ${value} (${ref.entity}, ${entity} expected)` };
    return { ok: true, id: ref.id };
  };
  for (const field of REF_FIELDS) {
    const value = input[field];
    if (!isRef(value)) continue;
    const entity = allowed[field];
    if (!entity) return { ok: false, error: `ref_not_allowed ${field}` };
    const r = take(value, entity);
    if (!r.ok) return r;
    input[field] = r.id;
  }
  if (Array.isArray(input.lines)) {
    const lines: unknown[] = [];
    for (const line of input.lines) {
      const l = line && typeof line === "object" ? { ...(line as Json) } : line;
      if (l && typeof l === "object" && isRef((l as Json).productId)) {
        const entity = allowed["lines.productId"];
        if (!entity) return { ok: false, error: "ref_not_allowed lines.productId" };
        const r = take((l as Json).productId as string, entity);
        if (!r.ok) return r;
        (l as Json).productId = r.id;
      }
      lines.push(l);
    }
    input.lines = lines;
  }
  return { ok: true, input };
}

const issues = (e: z.ZodError) =>
  e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");

/**
 * Joue les opérations dans l'ordre, sur `ctx.database` ; s'arrête à la première qui échoue. Après une
 * opération qui change l'entreprise (réglages, relances), les suivantes lisent l'entreprise telle
 * qu'elle est maintenant dans la transaction : deux réglages d'un même lot ne s'écrasent pas.
 */
async function runItems(start: AssistantContext, items: Item[]): Promise<Run> {
  let ctx = start;
  const refs = new Map<string, Ref>();
  const outcomes: OpSuccess[] = [];
  for (const [index, item] of items.entries()) {
    const problem = rightProblem(ctx, item.op);
    if (problem) return { ok: false, error: problem, index };
    const resolved = resolveRefs(item, refs);
    if (!resolved.ok) return { ok: false, error: resolved.error, index };
    const parsed = item.op.schema.safeParse(resolved.input);
    if (!parsed.success)
      return { ok: false, error: `invalid_input ${issues(parsed.error)}`, index };
    let out: OpOutcome;
    try {
      out = await item.op.run(ctx, parsed.data as Json);
    } catch (e) {
      console.error(
        "[assistant] opération en échec",
        item.op.id,
        e instanceof Error ? e.name : "inconnu",
      );
      out = fail("failed");
    }
    if (!out.ok) return { ok: false, error: out.error, index };
    if (item.key) refs.set(item.key, { id: out.result.id, entity: out.result.entity });
    outcomes.push(out);
    if (out.result.entity === "company" && index < items.length - 1) {
      const [organization] = await ctx.database
        .select()
        .from(organizations)
        .where(eq(organizations.id, ctx.organization.id));
      if (organization) ctx = { ...ctx, organization };
    }
  }
  return { ok: true, outcomes };
}

/**
 * Les opérations dans une transaction : annulée pour un essai à blanc (et pour tout échec), validée
 * sinon. Rend aussi les entreprises dont la file CRMlead attend un envoi, seulement si validée.
 */
async function transact(
  ctx: AssistantContext,
  items: Item[],
  mode: "dry" | "commit",
): Promise<{ run: Run; crmlead: Set<string> }> {
  let run: Run = { ok: false, error: "failed", index: 0 };
  const { effects } = await collectEffects(async () => {
    try {
      await ctx.database.transaction(async (tx) => {
        run = await runItems({ ...ctx, database: tx as unknown as Db }, items);
        if (mode === "dry" || !run.ok) throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        console.error("[assistant] transaction annulée", e instanceof Error ? e.name : "inconnu");
        run = { ok: false, error: "failed", index: 0 };
      }
    }
  });
  return { run, crmlead: mode === "commit" && run.ok ? effects.crmlead : new Set() };
}

/** Le lot demandé, opérations connues et utilisables dans un lot, clés uniques ; ou l'erreur. */
function batchItems(input: unknown): { ok: true; items: Item[] } | { ok: false; error: string } {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `invalid_input ${issues(parsed.error)}` };
  const keys = new Set<string>();
  const items: Item[] = [];
  for (const [i, o] of parsed.data.operations.entries()) {
    const op = OPS.get(o.op);
    if (!op || op.batch === false)
      return { ok: false, error: `operation ${i + 1}: not_batchable ${o.op}` };
    if (o.key) {
      if (keys.has(o.key))
        return { ok: false, error: `operation ${i + 1}: duplicate_key ${o.key}` };
      keys.add(o.key);
    }
    items.push({ op, input: o.input, key: o.key });
  }
  return { ok: true, items };
}

/** Carte d'un lot : groupes par action, cinq lignes par groupe, lignes des pièces s'il y en a peu. */
export function batchSummary(outcomes: OpSuccess[]): ConfirmSummary {
  const withLines = outcomes.filter((o) => o.item.lines).length <= 2;
  const groups: { action: string; count: number; items: BatchItem[] }[] = [];
  for (const o of outcomes) {
    let g = groups.find((x) => x.action === o.item.action);
    if (!g) {
      g = { action: o.item.action, count: 0, items: [] };
      groups.push(g);
    }
    g.count += 1;
    if (g.items.length < GROUP_SHOWN) {
      const { lines, totals, ...rest } = o.item;
      g.items.push(withLines ? o.item : rest);
    }
  }
  return { action: BATCH, fields: [], groups, count: outcomes.length };
}

/** Page qui montre le résultat d'un lot : sa pièce s'il n'y en a qu'une, la liste commune, ou la dernière. */
export function batchPath(results: OpResult[]): string {
  const last = results.at(-1);
  if (!last) return "/app";
  if (results.length === 1) return last.path;
  const documents = results.filter((r) => r.entity === "document");
  const unique = new Set(documents.map((d) => d.id));
  if (unique.size === 1 && documents[0]) return documents[0].path;
  const list = (p: string) => p.replace(/\/[0-9a-f-]{36}$/i, "").replace(/\?.*$/, "");
  const sections = new Set(results.map((r) => list(r.path)));
  return sections.size === 1 ? list(last.path) : last.path;
}

export type Proposal =
  | { ok: true; summary: ConfirmSummary; action: { tool: string; input: Json } }
  | { ok: false; error: string };

/** Proposition d'une opération : essai à blanc, rien n'est écrit. */
export async function proposeOne(
  ctx: AssistantContext,
  id: string,
  input: Json,
): Promise<Proposal> {
  const op = OPS.get(id);
  if (!op) return { ok: false, error: "unknown_operation" };
  const problem = rightProblem(ctx, op);
  if (problem) return { ok: false, error: problem };
  if (op.transactional === false) {
    const parsed = op.schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: `invalid_input ${issues(parsed.error)}` };
    const checked = op.check ? await op.check(ctx, parsed.data as Json) : fail("not_checked");
    return checked.ok
      ? { ok: true, summary: checked.summary, action: { tool: id, input } }
      : { ok: false, error: checked.error };
  }
  const { run } = await transact(ctx, [{ op, input }], "dry");
  if (!run.ok) return { ok: false, error: run.error };
  const [first] = run.outcomes;
  if (!first) return { ok: false, error: "failed" };
  return { ok: true, summary: first.summary, action: { tool: id, input } };
}

/** Proposition d'un lot : toutes les opérations jouées ensemble à blanc, rien n'est écrit. */
export async function proposeBatch(ctx: AssistantContext, input: Json): Promise<Proposal> {
  const parsed = batchItems(input);
  if (!parsed.ok) return parsed;
  const { run } = await transact(ctx, parsed.items, "dry");
  if (!run.ok) {
    const op = parsed.items[run.index]?.op.id ?? "";
    return { ok: false, error: `operation ${run.index + 1} (${op}): ${run.error}` };
  }
  return { ok: true, summary: batchSummary(run.outcomes), action: { tool: BATCH, input } };
}

/** Opérations d'une action signée (une, ou celles d'un lot), pour revérifier les droits. */
export function actionOperations(action: { tool: string; input: Json }): Operation[] | null {
  if (action.tool === BATCH) {
    const parsed = batchItems(action.input);
    return parsed.ok ? parsed.items.map((i) => i.op) : null;
  }
  const op = OPS.get(action.tool);
  return op ? [op] : null;
}

export type Applied = {
  action: string;
  id: string;
  path: string;
  label: string;
  /** Langue de l'interface choisie : la bulle rouvre la même page dans cette langue. */
  locale?: string;
  /** Lot : ce que chaque opération a écrit. */
  items?: OpResult[];
};

/**
 * Applique une action confirmée (jeton vérifié) : droits revérifiés pour chaque opération, une
 * transaction validée, puis les suites de l'écran hors de la transaction.
 */
export async function applyAction(
  ctx: AssistantContext,
  action: { tool: string; input: Json },
): Promise<{ ok: true; result: Applied } | { ok: false; error: string }> {
  let items: Item[];
  if (action.tool === BATCH) {
    const parsed = batchItems(action.input);
    if (!parsed.ok) return parsed;
    items = parsed.items;
  } else {
    const op = OPS.get(action.tool);
    if (!op) return { ok: false, error: "unknown_operation" };
    items = [{ op, input: action.input }];
  }
  for (const item of items) {
    const problem = rightProblem(ctx, item.op);
    if (problem) return { ok: false, error: problem };
  }
  let run: Run;
  let crmlead = new Set<string>();
  const single = items[0];
  if (items.length === 1 && single && single.op.transactional === false) {
    // Lecture par l'IA : comme l'écran, hors transaction (rien d'autre n'est écrit avec elle).
    run = await runItems(ctx, items);
  } else {
    ({ run, crmlead } = await transact(ctx, items, "commit"));
  }
  if (!run.ok) {
    const op = items[run.index]?.op.id ?? "";
    return {
      ok: false,
      error: items.length > 1 ? `operation ${run.index + 1} (${op}): ${run.error}` : run.error,
    };
  }
  await afterCommit(ctx, items, crmlead);
  const results = run.outcomes.map((o) => o.result);
  if (action.tool !== BATCH) {
    const [r] = results;
    if (!r) return { ok: false, error: "failed" };
    return {
      ok: true,
      result: {
        action: r.action,
        id: r.id,
        path: r.path,
        label: r.label,
        ...(r.locale ? { locale: r.locale } : {}),
      },
    };
  }
  return {
    ok: true,
    result: {
      action: BATCH,
      id: results[0]?.id ?? "",
      path: batchPath(results),
      label: String(results.length),
      items: results,
    },
  };
}

/** Suites de l'écran une fois la transaction validée : CRMlead, comptabilisation, webhooks. */
async function afterCommit(ctx: AssistantContext, items: Item[], crmlead: Set<string>) {
  const effects = new Set(items.flatMap((i) => i.op.effects ?? []));
  const w = { organizationId: ctx.organization.id, userId: ctx.userId };
  if (effects.has("post")) {
    try {
      await postPending(ctx.database, w);
    } catch (e) {
      console.error(
        "[ledger] comptabilisation reportée",
        e instanceof Error ? e.message : "inconnu",
      );
    }
  }
  if (effects.has("webhooks")) await flushWebhooks(ctx.database, ctx.organization.id);
  for (const org of crmlead) await scheduleCrmleadDelivery(ctx.database, org);
}
