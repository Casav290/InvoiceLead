"use client";

import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { AppMark } from "@/components/brand/AppMark";
import type { LeadAppItem } from "@/lib/lead-apps";
import { cn } from "@/lib/utils";

const MARK_COLORS: Record<string, string> = {
  scanlead: "bg-scanlead",
  crmlead: "bg-crmlead",
  projectlead: "bg-projectlead",
  invoicelead: "bg-accent",
};

export function AppSwitcher({ items }: { items: LeadAppItem[] }) {
  const t = useTranslations("app.switcher");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("open")}
          data-testid="application-switcher"
          className="flex h-8 w-8 items-center justify-center border border-line-strong bg-panel text-ink-3 hover:bg-muted"
        >
          <span className="grid grid-cols-3 gap-[3px]" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="h-[3px] w-[3px] bg-current" />
            ))}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[260px] border border-line-strong bg-panel p-2 font-sans text-[13px] text-ink"
        >
          <DropdownMenu.Label className="px-2 pt-1 pb-2 text-[10px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
            {t("title")}
          </DropdownMenu.Label>
          {items.map((item) => {
            const mark = (
              <AppMark
                label={item.mark}
                className={cn(
                  MARK_COLORS[item.code] ?? "bg-line-strong",
                  "h-[26px] w-[26px] text-[9px]",
                )}
              />
            );
            const label = {
              current: t("current"),
              open: t("openLink"),
              soon: t("soon"),
              upgrade: t("upgrade"),
            }[item.state];
            const inner = (
              <>
                {mark}
                <span className="flex-1 font-semibold">{item.name}</span>
                <span className="text-[12px] text-ink-muted">{label}</span>
              </>
            );
            const rowClass =
              "flex items-center gap-2.5 px-2 py-2 outline-hidden data-[highlighted]:bg-accent-veil data-[highlighted]:outline-2 data-[highlighted]:outline-accent data-[highlighted]:-outline-offset-2";
            if (item.href) {
              return (
                <DropdownMenu.Item key={item.code} asChild>
                  <a
                    href={item.href}
                    data-testid={`application-switcher-${item.code}`}
                    className={cn(rowClass, "cursor-pointer")}
                  >
                    {inner}
                  </a>
                </DropdownMenu.Item>
              );
            }
            return (
              <DropdownMenu.Item
                key={item.code}
                disabled
                className={cn(rowClass, item.state === "soon" && "text-ink-muted")}
              >
                {inner}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
