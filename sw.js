/* Service Worker — Warframe Tracker
 *
 * Cache hors-ligne SÛR, conçu pour ne jamais bloquer les visiteurs sur une
 * vieille version :
 *   - HTML / navigation : network-first. En ligne => toujours la dernière
 *     version. Hors-ligne => dernière version vue (secours).
 *   - Assets statiques même origine (items.js, css…) : cache-first avec
 *     revalidation en arrière-plan (chargement instantané).
 *   - Requêtes cross-origin (Cloudflare Worker, APIs de prix) : NON
 *     interceptées => les prix restent toujours frais.
 *
 * KILL-SWITCH : en cas de problème, remplace tout ce fichier par :
 *     self.addEventListener('install', () => self.skipWaiting());
 *     self.addEventListener('activate', (e) => e.waitUntil(
 *       self.registration.unregister().then(() =>
 *         self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate(c.url)))));
 *   puis pousse-le : tous les visiteurs se désinscrivent au prochain chargement.
 *
 * Pour forcer un rafraîchissement complet du cache après une grosse mise à
 * jour, incrémente le numéro dans CACHE (v1 -> v2).
 */

const CACHE = 'wf-cache-v1';
const PRECACHE = ['index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Cross-origin (Cloudflare Worker, warframe.market, proxies…) : on laisse
  // passer sans toucher, pour garder des prix toujours à jour.
  if (url.origin !== self.location.origin) return;

  // HTML / navigation : network-first, secours cache si hors-ligne.
  const isHTML = req.mode === 'navigate' ||
                 url.pathname.endsWith('/') ||
                 url.pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
    );
    return;
  }

  // Assets statiques même origine : cache-first + revalidation en arrière-plan.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
