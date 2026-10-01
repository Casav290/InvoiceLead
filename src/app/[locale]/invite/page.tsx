import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { INVITE_TOKEN, pickLocale } from "@/server/auth/login-cookie";
import { getSession } from "@/server/auth/session";
import { acceptInvitationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.invite" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["invalid", "expired", "wrongEmail", "plan"];

/** Invitation de fiduciaire : connexion avec son propre Compte Lead, puis acceptation. */
export default async function InvitePage({ params, searchParams }: Props) {
  const locale = pickLocale((await params).locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.invite" });
  const token = q.token && INVITE_TOKEN.test(q.token) ? q.token : null;
  const session = await getSession();
  const error = !token ? "invalid" : q.error && ERRORS.includes(q.error) ? q.error : null;

  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-20">
      <div className="w-full max-w-[480px] border border-line-strong bg-panel" data-testid="invite">
        <div className="border-b border-line px-6 py-5">
          <h1 className="text-[22px] leading-tight">{t("title")}</h1>
          {error ? (
            <p role="alert" className="mt-3 text-[14px] leading-relaxed text-hot-fg">
              {t(error, { email: session?.user.email ?? "" })}
            </p>
          ) : !session ? (
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{t("loginBody")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 px-6 py-5">
          {!token ||
          error === "invalid" ||
          error === "expired" ||
          error === "plan" ? null : !session ? (
            <Button asChild>
              <a href={`/auth/lead/start?locale=${locale}&invite=${token}`}>{t("login")}</a>
            </Button>
          ) : error ? (
            <form action="/auth/lead/logout" method="post">
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary">
                {t("logout")}
              </Button>
            </form>
          ) : (
            <form action={acceptInvitationAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <Button type="submit" data-testid="invite-accept">
                {t("accept")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
