"use client";

import { useEffect, useState } from "react";
import {
  type AppWindow,
  departUnlessReturned,
  followReturnPage,
  listenForReturn,
  startRelay,
} from "@/lib/lead-app-auth";

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
 * La page relais : « Connexion avec Google… », le navigateur sûr du téléphone ouvert sur le départ
 * d'ERPlead (session iOS, Safari ou Custom Tab), et un lien « Retour » vers l'écran de connexion. Quand
 * la connexion se finit dans Safari (iOS 15 à 17.3), le texte dit de toucher « Ouvrir InvoiceLead ».
 */
export function GoogleRelay({
  issuer,
  start,
  back,
  locale,
  title,
  body,
  safariBody,
  backLabel,
}: {
  issuer: string | null;
  start: string | null;
  back: string | null;
  locale: string;
  title: string;
  body: string;
  safariBody: string;
  backLabel: string;
}) {
  const [safari, setSafari] = useState(false);
  useEffect(() => {
    startRelay(window as unknown as AppWindow, {
      issuer,
      start,
      back,
      locale,
      onSafari: () => setSafari(true),
    });
  }, [issuer, start, back, locale]);
  return (
    <main className="flex min-h-screen items-start px-4 py-14 sm:py-20">
      <div
        className="mx-auto w-full max-w-[440px] border border-line-strong bg-panel"
        data-lead-auth-relay
      >
        <div className="px-6 py-5">
          <h1 className="text-[24px] leading-tight">{title}</h1>
          <p
            className="mt-2 text-[14px] leading-relaxed text-ink-muted"
            aria-live="polite"
            data-lead-auth-mode={safari ? "safari" : "auto"}
          >
            {safari ? safariBody : body}
          </p>
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
 * Écran de connexion dans l'app (versions LeadAppAuth/2) : avant de partir vers le Compte Lead, le
 * lien de lancement est lu. L'app relancée par son lien de retour (fermée pendant la connexion Google)
 * va au rachat d'ERPlead (lien de lancement, ou appUrlOpen gardé par la coque) et cet écran ne part
 * plus ; sinon, la connexion ordinaire part tout de suite (departUnlessReturned).
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
    void departUnlessReturned(window as unknown as AppWindow, {
      issuer,
      locale,
      href,
      live: () => live,
    });
    return () => {
      live = false;
    };
  }, [issuer, locale, href]);
  return <main className="min-h-screen" aria-busy="true" data-lead-auth-boot />;
}

/**
 * Le lien de retour ouvert par la vue web de l'app elle-même (`/<langue>/lead-auth/return?…`) : son
 * adresse suit les règles du lien de retour (followReturnPage) ; hors de l'app, la page de repli.
 */
export function LeadAppReturnPage({ issuer, locale }: { issuer: string | null; locale: string }) {
  useEffect(() => {
    void followReturnPage(window as unknown as AppWindow, { issuer, locale });
  }, [issuer, locale]);
  return <main className="min-h-screen" aria-busy="true" data-lead-auth-return-app />;
}
