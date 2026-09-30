"use client";

import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";

export function UserMenu({
  name,
  email,
  planLabel,
  locale,
}: {
  name: string;
  email: string;
  planLabel: string;
  locale: string;
}) {
  const t = useTranslations("app.user");
  // Le formulaire reste hors du menu : le contenu du menu disparaît à sa fermeture.
  const logoutForm = useRef<HTMLFormElement>(null);
  const initials =
    (name || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <>
      <form ref={logoutForm} action="/auth/lead/logout" method="post" hidden>
        <input type="hidden" name="locale" value={locale} />
      </form>
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
            <DropdownMenu.Label className="px-2 pt-1 pb-2">
              <span className="block truncate font-semibold">{name || email}</span>
              <span className="block truncate text-[12px] text-ink-muted">{email}</span>
              <span className="mt-1 block text-[12px] text-ink-muted">
                {t.rich("planLine", {
                  plan: planLabel,
                  strong: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
                })}
              </span>
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              data-testid="logout"
              onSelect={() => logoutForm.current?.requestSubmit()}
              className="cursor-pointer px-2 py-2 font-semibold outline-hidden data-[highlighted]:bg-accent-veil data-[highlighted]:outline-2 data-[highlighted]:outline-accent data-[highlighted]:-outline-offset-2"
            >
              {t("logout")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
