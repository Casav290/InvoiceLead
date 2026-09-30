"use client";

import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";

export function UserMenu({
  name,
  email,
  plan,
  locale,
}: {
  name: string;
  email: string;
  plan: string;
  locale: string;
}) {
  const t = useTranslations("app.user");
  const initials =
    (name || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="user-menu"
          aria-label={name || email}
          className="flex h-8 min-w-8 items-center justify-center border border-line-strong bg-panel px-2 text-[11px] font-extrabold text-ink hover:bg-muted"
        >
          {initials}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[240px] border border-line-strong bg-panel p-2 font-sans text-[13px] text-ink"
        >
          <div className="px-2 pt-1 pb-2">
            <p className="truncate font-semibold">{name || email}</p>
            <p className="truncate text-[12px] text-ink-muted">{email}</p>
            <p className="mt-1 text-[12px] text-ink-muted">
              {t("plan")} : <span className="font-semibold text-ink">{plan}</span>
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <form action="/auth/lead/logout" method="post">
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              data-testid="logout"
              className="w-full px-2 py-2 text-left font-semibold hover:bg-muted"
            >
              {t("logout")}
            </button>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
