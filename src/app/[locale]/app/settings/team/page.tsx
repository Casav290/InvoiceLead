import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LockNote, ProBadge, ProLock } from "@/components/app/ProLock";
import { fieldClass } from "@/components/forms/fields";
import { FiduciaryInvite } from "@/components/settings/FiduciaryInvite";
import { MemberInvite } from "@/components/settings/MemberInvite";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { lockFor, planLock } from "@/server/plan-lock";
import { featureAccess, PLANS, seatsOf, tierOf, tierWithMoreSeats } from "@/server/plans";
import { APP_ROLES, appRoleOf, can, isManager } from "@/server/roles";
import { canRemove, INVITATION_DAYS, listTeam, seated } from "@/server/team";
import {
  cancelInvitationAction,
  removeFiduciaryAction,
  removeMemberAction,
  restoreMemberAction,
  setAppRoleAction,
} from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    saved?: string;
    removed?: string;
    retired?: string;
    restored?: string;
    /** Premier temps de « Retirer » : la personne dont on confirme le retrait. */
    retirer?: string;
    error?: string;
  }>;
};

const REMOVE_ERRORS = ["self", "forbidden", "invalid"];
const isoDay = (d: Date) => formatDate(d.toISOString().slice(0, 10));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.team" });
  return { title: t("title"), robots: { index: false } };
}

const head =
  "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

/**
 * Réglages → Équipe. La liste des personnes qui occupent une place (contrat du banc check-seats.mjs :
 * [data-seat-list] avec data-seats-used et data-seats-max, une ligne [data-seat-holder] par place,
 * [data-last-seen] dans chaque ligne, bouton [data-seat-remove]), avec la dernière venue de chacune ;
 * « Retirer » en deux temps (la confirmation nomme la personne et dit l'effet), réservé aux
 * responsables et jamais sur soi ; les personnes retirées à part ([data-seat-removed]) avec
 * « Rétablir ».
 */
export default async function TeamPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership, user } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.team" });
  const editable = can(membership, "company");
  const { members, removed, fiduciaries, invitations } = await listTeam(db(), organization.id);
  const seats = seatsOf(organization);
  const withSeat = seated(members, seats);
  const viewer = { ...membership, userId: user.id };
  // Second temps de « Retirer » : seulement pour une personne que ce responsable peut retirer.
  const confirming = q.retirer
    ? members.find((m) => m.userId === q.retirer && canRemove(viewer, m))
    : undefined;
  // Accès fiduciaire : formule Pro ; en dessous, l'invitation reste visible, grisée, et l'accès
  // d'une fiduciaire déjà invitée est suspendu (rendu au retour à Pro).
  const fiduciaryAccess = featureAccess(organization, "fiduciary");
  const fiduciaryLock = await lockFor(locale, fiduciaryAccess, t("planOnly"));
  // Places : la première formule supérieure qui en donne davantage (Pro+ depuis Gratuit, Pro
  // n'ayant qu'une place) ; marque et lien à côté du compteur.
  const tier = tierOf(organization);
  const nextTier = tierWithMoreSeats(tier, seats);
  const seatsLock = nextTier
    ? await planLock(
        locale,
        nextTier,
        t("moreSeats", {
          tier: nextTier,
          pro: PLANS.pro.seats,
          plus: PLANS.proplus.seats,
        }),
      )
    : null;
  // Ajout d'une personne (administrateur seulement) : toutes les places prises, la commande reste
  // visible, grisée, avec la marque et le lien de la formule qui en donne davantage ; le serveur
  // refuse de même (inviteMemberAction, seatLimit).
  const inviter = editable && membership.role === "admin";
  const inviteLock = inviter && withSeat.size >= seats ? seatsLock : null;
  const notice = q.saved
    ? t("saved")
    : q.removed
      ? t("removed")
      : q.retired
        ? t("memberRemoved")
        : q.restored
          ? t("memberRestored")
          : null;
  const removeError = q.error && REMOVE_ERRORS.includes(q.error) ? q.error : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
          data-testid="team-notice"
        >
          {notice}
        </p>
      ) : null}
      {removeError ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`removeErrors.${removeError}`)}
        </p>
      ) : null}
      {editable ? null : <p className="mt-6 text-[13px] text-ink-2">{t("managersOnly")}</p>}

      <section
        className="mt-6 border border-line-strong bg-panel"
        data-testid="team-members"
        data-seat-list=""
        data-seats-used={withSeat.size}
        data-seats-max={seats}
      >
        <h2 className={`${head} flex flex-wrap justify-between gap-2`}>
          <span>{t("members")}</span>
          <span data-testid="seats">{t("seats", { used: withSeat.size, seats })}</span>
        </h2>
        <ul>
          {members.map((m) => {
            const manager = isManager(m);
            const name = m.name || m.email;
            return (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-b-0"
                data-testid="team-member"
                data-seat-holder={withSeat.has(m.userId) ? m.email.toLowerCase() : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold [overflow-wrap:anywhere]">{name}</p>
                  <p className="text-[12px] text-ink-muted [overflow-wrap:anywhere]">
                    {m.email} · {t(`leadRoles.${manager ? m.role : "user"}`)}
                    {withSeat.has(m.userId) || appRoleOf(m) === "none" ? "" : ` · ${t("noSeat")}`}
                  </p>
                  <p
                    className="text-[12px] text-ink-muted"
                    data-last-seen={m.lastSeenAt ? m.lastSeenAt.toISOString() : "never"}
                  >
                    {m.lastSeenAt
                      ? t("lastSeen", { date: isoDay(m.lastSeenAt) })
                      : t("lastSeenNever")}
                  </p>
                </div>
                {manager ? (
                  <span className="text-[13px] text-ink-2">{t("managerRole")}</span>
                ) : editable ? (
                  <form action={setAppRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <select
                      name="appRole"
                      defaultValue={appRoleOf(m)}
                      aria-label={t("appRole")}
                      className={`${fieldClass} w-auto`}
                    >
                      {APP_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`roles.${r}`)}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="secondary">
                      {t("save")}
                    </Button>
                  </form>
                ) : (
                  <span className="text-[13px] text-ink-2">{t(`roles.${appRoleOf(m)}`)}</span>
                )}
                {canRemove(viewer, m) ? (
                  <a
                    href={`/${locale}/app/settings/team?${new URLSearchParams({ retirer: m.userId })}#retirer`}
                    className={buttonVariants({ variant: "secondary" })}
                    aria-label={t("removeMemberLabel", { name })}
                    data-seat-remove=""
                    data-testid="member-remove"
                  >
                    {t("removeMember")}
                  </a>
                ) : null}
                {confirming?.userId === m.userId ? (
                  <div
                    id="retirer"
                    role="alertdialog"
                    aria-labelledby="retirer-title"
                    className="basis-full border border-hot-fg bg-hot-bg px-4 py-3 text-hot-fg"
                    data-testid="remove-confirm"
                  >
                    <p id="retirer-title" className="text-[14px] font-bold">
                      {t("removeTitle", { name })}
                    </p>
                    <p className="mt-1 text-[13px]">
                      {t("removeBody", { org: organization.name })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <form action={removeMemberAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" data-testid="remove-confirm-submit">
                          {t("removeConfirm", { name })}
                        </Button>
                      </form>
                      <a
                        href={`/${locale}/app/settings/team`}
                        className={buttonVariants({ variant: "secondary" })}
                      >
                        {t("keepMember")}
                      </a>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {inviteLock ? (
          <ProLock lock={inviteLock} testId="seats-lock" className="border-x-0 border-b-0">
            <MemberInvite locale={locale} />
          </ProLock>
        ) : inviter ? (
          <MemberInvite locale={locale} />
        ) : (
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
            {t("addHint")}
          </p>
        )}
        {seatsLock && !inviteLock ? (
          <LockNote
            lock={seatsLock}
            testId="seats-lock"
            className="border-t border-line-strong bg-muted px-5 py-3"
          />
        ) : null}
      </section>

      {editable && removed.length > 0 ? (
        <section className="mt-8 border border-line-strong bg-panel" data-testid="team-removed">
          <h2 className={head}>{t("removedTitle")}</h2>
          <p className="px-5 pt-4 text-[13px] text-ink-2">{t("removedHint")}</p>
          <ul className="mt-3">
            {removed.map((m) => {
              const name = m.name || m.email;
              return (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-3"
                  data-seat-removed={m.email.toLowerCase()}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold [overflow-wrap:anywhere]">{name}</p>
                    <p className="text-[12px] text-ink-muted [overflow-wrap:anywhere]">
                      {m.email}
                      {m.removedAt ? ` · ${t("removedOn", { date: isoDay(m.removedAt) })}` : ""}
                    </p>
                  </div>
                  <form action={restoreMemberAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <Button
                      type="submit"
                      variant="secondary"
                      aria-label={t("restoreLabel", { name })}
                      data-testid="member-restore"
                    >
                      {t("restore")}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 border border-line-strong bg-panel" data-testid="team-fiduciary">
        <h2 className={head}>{t("fiduciaryTitle")}</h2>
        <p className="px-5 pt-4 text-[13px] text-ink-2">{t("fiduciaryHint")}</p>
        <ul className="mt-3">
          {fiduciaries.map((f) => (
            <li
              key={f.userId}
              className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-3"
              data-testid="fiduciary"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] [overflow-wrap:anywhere]">
                  <span className="font-semibold">{f.name || f.email}</span>{" "}
                  <span className="text-[12px] text-ink-muted">{f.email}</span>
                </p>
                {fiduciaryAccess.allowed ? null : (
                  <p
                    className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2"
                    data-testid="fiduciary-suspended"
                  >
                    <ProBadge tier="pro" />
                    {t("suspended")}
                  </p>
                )}
              </div>
              {editable ? (
                <form action={removeFiduciaryAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="userId" value={f.userId} />
                  <Button type="submit" variant="secondary" data-testid="fiduciary-remove">
                    {t("remove")}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
          {invitations.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-3"
              data-testid="invitation"
            >
              <p className="min-w-0 flex-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
                <span className="font-semibold text-ink">{i.email}</span> ·{" "}
                {t("pending", { date: formatDate(i.expiresAt.toISOString().slice(0, 10)) })}
              </p>
              {editable ? (
                <form action={cancelInvitationAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={i.id} />
                  <Button type="submit" variant="secondary">
                    {t("cancel")}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {fiduciaries.length === 0 && invitations.length === 0 ? (
          <p className="px-5 pb-4 text-[13px] text-ink-muted">{t("noFiduciary")}</p>
        ) : null}
        {fiduciaryLock ? (
          <ProLock lock={fiduciaryLock} testId="fiduciary-lock" className="border-x-0 border-b-0">
            <FiduciaryInvite locale={locale} days={INVITATION_DAYS} />
          </ProLock>
        ) : editable ? (
          <FiduciaryInvite locale={locale} days={INVITATION_DAYS} />
        ) : null}
      </section>
    </div>
  );
}
