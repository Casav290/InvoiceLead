"use client";

import { useEffect } from "react";
import { type AppWindow, listenForReturn, startRelay } from "@/lib/lead-app-auth";

/**
 * Retour de la connexion Google dans l'app Android / iOS (lib/lead-app-auth.ts). Hors de l'app (aucun
 * pont Capacitor natif), ces composants ne font rien de plus que s'afficher.
 */

/** Sur chaque page : l'écoute du lien de retour de l'app (appUrlOpen et lien de lancement). */
export function LeadAppReturn({ issuer, locale }: { issuer: string | null; locale: string }) {
  useEffect(() => {
    void listenForReturn(window as unknown as AppWindow, { issuer, locale });
  }, [issuer, locale]);
  return null;
}

/**
 * La page relais : « Connexion avec Google… », le navigateur du téléphone ouvert sur le départ
 * d'ERPlead, et un lien « Retour » vers l'écran de connexion.
 */
export function GoogleRelay({
  issuer,
  start,
  back,
  locale,
  title,
  body,
  backLabel,
}: {
  issuer: string | null;
  start: string | null;
  back: string | null;
  locale: string;
  title: string;
  body: string;
  backLabel: string;
}) {
  useEffect(() => {
    startRelay(window as unknown as AppWindow, { issuer, start, back, locale });
  }, [issuer, start, back, locale]);
  return (
    <main className="flex min-h-screen items-start px-4 py-14 sm:py-20">
      <div
        className="mx-auto w-full max-w-[440px] border border-line-strong bg-panel"
        data-lead-auth-relay
      >
        <div className="px-6 py-5">
          <h1 className="text-[24px] leading-tight" aria-live="polite">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{body}</p>
          <p className="mt-5 text-[14px]">
            <a
              href={back ?? `/auth/lead/start?${new URLSearchParams({ locale })}`}
              className="underline underline-offset-4"
              data-lead-auth-back
            >
              {backLabel}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * Écran de connexion dans l'app (versions LeadAppAuth/1) : avant de partir vers le Compte Lead, le
 * lien de lancement est lu. L'app relancée par son lien de retour (fermée pendant la connexion Google)
 * va au rachat d'ERPlead ; sinon, la connexion ordinaire part tout de suite.
 */
export function LeadAppLoginRedirect({
  issuer,
  locale,
  href,
}: {
  issuer: string | null;
  locale: string;
  href: string;
}) {
  useEffect(() => {
    let live = true;
    void listenForReturn(window as unknown as AppWindow, { issuer, locale }).then((handled) => {
      if (live && !handled) window.location.replace(href);
    });
    return () => {
      live = false;
    };
  }, [issuer, locale, href]);
  return <main className="min-h-screen" aria-busy="true" data-lead-auth-boot />;
}
