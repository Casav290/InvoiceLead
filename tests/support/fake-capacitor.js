/**
 * Faux pont Capacitor des essais en navigateur sans tête (e2e google-app, porte G3) : ce que la coque
 * native de l'app injecte dans chaque page de sa vue web, en petit. window.Capacitor.isNativePlatform,
 * Plugins.App (addListener « appUrlOpen », getLaunchUrl) et Plugins.Browser (open, close, addListener
 * « browserFinished »). Chaque appel est remis à l'essai par la liaison window.__bridgeCall (si elle
 * existe) ; window.__fakeEmit(« App.appUrlOpen », { url }) imite l'arrivée d'un lien.
 *
 * Réglage, posé avant ce script : window.__FAKE_CAPACITOR = { launchUrl } (le lien de lancement que
 * rend getLaunchUrl, sur chaque page comme iOS le fait de son dernier lien).
 */
(() => {
  if (window.top !== window) return;
  // Lu à chaque appel : le réglage peut être posé par un autre script d'ouverture de page.
  const config = () => window.__FAKE_CAPACITOR || {};
  const listeners = {};
  const record = (name, arg) => {
    try {
      if (typeof window.__bridgeCall === "function") window.__bridgeCall(name, arg ?? null);
    } catch {
      // l'essai n'écoute pas
    }
  };
  const add = (plugin) => (event, cb) => {
    const key = `${plugin}.${event}`;
    listeners[key] = [...(listeners[key] || []), cb];
    record(`${plugin}.addListener`, event);
    return { remove: async () => {} };
  };
  window.__fakeEmit = (key, payload) => {
    const list = listeners[key] || [];
    for (const cb of list) cb(payload);
    return list.length;
  };
  window.__fakeListeners = (key) => (listeners[key] || []).length;
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => config().platform || "ios",
    Plugins: {
      App: {
        addListener: add("App"),
        getLaunchUrl: async () => {
          const launchUrl = config().launchUrl || null;
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
    },
  };
})();
