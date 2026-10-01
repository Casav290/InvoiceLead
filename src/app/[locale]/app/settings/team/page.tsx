import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/app/PlanNotice";
import { fieldClass } from "@/components/forms/fields";
import { FiduciaryInvite } from "@/components/settings/FiduciaryInvite";
import { MemberInvite } from "@/components/settings/MemberInvite";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { hasFeature, seatsOf, upgradeUrl } from "@/server/plans";
import { APP_ROLES, appRoleOf, can, isManager } from "@/server/roles";
import { INVITATION_DAYS, listTeam, seated } from "@/server/team";
import { cancelInvitationAction, removeFiduciaryAction, setAppRoleAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; removed?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.team" });
  return { title: t("title"), robots: { index: false } };
}

const head =
  "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

export default async function TeamPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.team" });
  const editable = can(membership, "company");
  const { members, fiduciaries, invitations } = await listTeam(db(), organization.id);
  const seats = seatsOf(organization);
  const withSeat = seated(members, seats);
  const fiduciaryAllowed = hasFeature(organization, "fiduciary");
  const notice = q.saved ? t("saved") : q.removed ? t("removed") : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {editable ? null : <p className="mt-6 text-[13px] text-ink-2">{t("managersOnly")}</p>}

      <section className="mt-6 border border-line-strong bg-panel" data-testid="team-members">
        <h2 className={`${head} flex flex-wrap justify-between gap-2`}>
          <span>{t("members")}</span>
          <span data-testid="seats">{t("seats", { used: withSeat.size, seats })}</span>
        </h2>
        <ul>
          {members.map((m) => {
            const manager = isManager(m);
            return (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-b-0"
                data-testid="team-member"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold [overflow-wrap:anywhere]">
                    {m.name || m.email}
                  </p>
                  <p className="text-[12px] text-ink-muted [overflow-wrap:anywhere]">
                    {m.email} · {t(`leadRoles.${manager ? m.role : "user"}`)}
                    {withSeat.has(m.userId) || appRoleOf(m) === "none" ? "" : ` · ${t("noSeat")}`}
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
              </li>
            );
          })}
        </ul>
        {editable && membership.role === "admin" ? (
          <MemberInvite locale={locale} />
        ) : (
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
            {t("addHint")}
          </p>
        )}
      </section>

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
              <p className="min-w-0 flex-1 text-[14px] [overflow-wrap:anywhere]">
                <span className="font-semibold">{f.name || f.email}</span>{" "}
                <span className="text-[12px] text-ink-muted">{f.email}</span>
              </p>
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
        {!fiduciaryAllowed ? (
          <div className="px-5 pb-4">
            <PlanNotice locale={locale} message={t("planOnly")} href={upgradeUrl(organization)} />
          </div>
        ) : editable ? (
          <FiduciaryInvite locale={locale} days={INVITATION_DAYS} />
        ) : null}
      </section>
    </div>
  );
}
