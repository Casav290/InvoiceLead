/**
 * Faux pont Capacitor des essais en navigateur sans tête (e2e google-app, porte G3) : ce que la coque
 * native de l'app injecte dans chaque page de sa vue web, en petit. window.Capacitor.isNativePlatform,
 * getPlatform, Plugins.App (addListener « appUrlOpen », getLaunchUrl), Plugins.Browser (open, close,
 * addListener « browserFinished ») et, sur iOS, Plugins.LeadAuthSession (module natif de l'app :
 * isAvailable, start, openExternal). Chaque appel est remis à l'essai par la liaison window.__bridgeCall
 * (si elle existe) ; window.__fakeEmit(« App.appUrlOpen », { url }) imite l'arrivée d'un lien ;
 * window.__fakeSession({ url } | { error: code }) termine la session iOS en cours (adresse de retour
 * rendue, ou refus : canceled, unavailable, busy, bad_url, failed).
 *
 * Réglage, posé avant ce script : window.__FAKE_CAPACITOR = { launchUrl, platform, session } :
 * - launchUrl : le lien de lancement que rend getLaunchUrl (sur chaque page, comme iOS de son dernier lien) ;
 * - retained : un lien appUrlOpen RETENU par la coque (app relancée par son lien, ou page rechargée : Capacitor
 *   le garde, retainUntilConsumed) : livré une seule fois par vue web, à la première écoute « appUrlOpen »,
 *   AVANT la réponse de getLaunchUrl (la coque traite les appels natifs dans l'ordre) ;
 * - platform : « ios » (défaut) ou « android » ;
 * - session (iOS) : « https » (défaut, iOS 17.4+), « old » (iOS 15 à 17.3 : https: false), « none » (module absent).
 */
(() => {
  if (window.top !== window) return;
  // Lu à chaque appel : le réglage peut être posé par un autre script d'ouverture de page.
  const config = () => window.__FAKE_CAPACITOR || {};
  const platform = () => config().platform || "ios";
  const listeners = {};
  const record = (name, arg) => {
    try {
      if (typeof window.__bridgeCall === "function") window.__bridgeCall(name, arg ?? null);
    } catch {
      // l'essai n'écoute pas
    }
  };
  /** L'appUrlOpen retenu par la coque : une seule fois par vue web (marque dans sessionStorage). */
  const RETAINED_DONE = "__fakeRetainedDone";
  const deliverRetained = (cb) => {
    const url = config().retained;
    if (!url) return;
    try {
      if (sessionStorage.getItem(RETAINED_DONE) === url) return;
      sessionStorage.setItem(RETAINED_DONE, url);
    } catch {
      // sans stockage : livré à chaque page
    }
    setTimeout(() => {
      record("App.appUrlOpen", url);
      cb({ url });
    }, 0);
  };
  const add = (plugin) => (event, cb) => {
    const key = `${plugin}.${event}`;
    listeners[key] = [...(listeners[key] || []), cb];
    record(`${plugin}.addListener`, event);
    if (key === "App.appUrlOpen") deliverRetained(cb);
    return { remove: async () => {} };
  };
  window.__fakeEmit = (key, payload) => {
    const list = listeners[key] || [];
    for (const cb of list) cb(payload);
    return list.length;
  };
  window.__fakeListeners = (key) => (listeners[key] || []).length;
  let session = null;
  window.__fakeSession = (result) => {
    const s = session;
    session = null;
    if (!s) return false;
    if (result?.url) s.resolve({ url: result.url });
    else s.reject(Object.assign(new Error(result?.error || "failed"), { code: result?.error }));
    return true;
  };
  window.__fakeSessionOpen = () => !!session;
  const plugins = {
    App: {
      addListener: add("App"),
      getLaunchUrl: async () => {
        const launchUrl = config().launchUrl || null;
        // Réponses natives dans l'ordre des appels : l'évènement retenu (addListener) arrive avant.
        if (config().retained) await new Promise((done) => setTimeout(done, 50));
        record("App.getLaunchUrl", launchUrl);
        return launchUrl ? { url: launchUrl } : undefined;
      },
    },
    Browser: {
      open: async (options) => {
        record("Browser.open", options?.url ?? null);
      },
      close: async () => {
        record("Browser.close", null);
      },
      addListener: add("Browser"),
    },
  };
  if (platform() === "ios" && config().session !== "none")
    plugins.LeadAuthSession = {
      isAvailable: async () => {
        const https = (config().session || "https") === "https";
        record("LeadAuthSession.isAvailable", https);
        return { https };
      },
      start: (options) => {
        record("LeadAuthSession.start", options?.url ?? null);
        if (session) return Promise.reject(Object.assign(new Error("busy"), { code: "busy" }));
        return new Promise((resolve, reject) => {
          session = { resolve, reject };
        });
      },
      openExternal: async (options) => {
        record("LeadAuthSession.openExternal", options?.url ?? null);
        return { opened: true };
      },
    };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: platform,
    Plugins: plugins,
  };
})();
