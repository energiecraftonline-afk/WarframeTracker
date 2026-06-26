// --- CLOUDFLARE WORKER + KV : PROXY & CACHE PARTAGÉ WARFRAME TRACKER ---
//
// Cache PARTAGÉ entre tous les visiteurs. Le premier visiteur qui charge une
// donnée la met en cache dans KV ; tous les suivants la lisent depuis KV
// (rapide, mondial, gratuit) jusqu'à expiration. Aucun token exposé.
//
// DÉPLOIEMENT (voir aussi wrangler.toml) :
//   1. Crée un compte Cloudflare gratuit : https://dash.cloudflare.com
//   2. Crée un namespace KV : Workers & Pages > KV > Create namespace (nom : WF_CACHE)
//   3. Crée un Worker, colle ce code.
//   4. Lie le namespace au Worker : Settings > Variables & Bindings > KV namespace
//      Variable name = WF_CACHE   |   Namespace = celui créé à l'étape 2
//   5. Déploie ("Deploy"). Copie l'URL (ex : https://mon-proxy.mon-pseudo.workers.dev)
//   6. Colle cette URL dans CLOUDFLARE_WORKER_URL en haut de index.html

// Domaines autorisés (mêmes que le serveur local server.js)
const ALLOWED = [
  'https://api.warframe.market/',
  'https://warframestat.us/',
  'https://drops.warframestat.us/',
  'https://api.warframestat.us/',
  'https://relics.run/'
];

// Durée de validité (TTL) selon le type de requête. KV impose un minimum de 60 s.
function getTTL(targetUrl) {
  // Worldstate : change très souvent (cycle jour/nuit, fissures…)
  if (targetUrl.includes('api.warframestat.us/pc')) {
    return 60; // 1 minute
  }
  // Prix / ordres en direct sur warframe.market
  if (targetUrl.includes('api.warframe.market/v2/orders/item/') ||
      targetUrl.includes('api.warframe.market/v1/items/')) {
    return 5 * 60; // 5 minutes
  }
  // Historique des prix, tables de drops, reliques : quasi statiques
  if (targetUrl.includes('relics.run/history/') ||
      targetUrl.includes('drops.warframestat.us/data/') ||
      targetUrl.includes('api.warframestat.us/items')) {
    return 24 * 60 * 60; // 24 heures
  }
  return 10 * 60; // 10 minutes par défaut
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

export default {
  async fetch(request, env) {
    // Pré-vol CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const bypass = url.searchParams.get('nocache') === '1';

    if (!targetUrl) {
      return json({ error: 'Paramètre "url" manquant.' }, 400);
    }

    // Sécurité : restreindre les domaines proxifiables
    if (!ALLOWED.some(prefix => targetUrl.startsWith(prefix))) {
      return json({ error: 'URL non autorisée par le proxy.' }, 403);
    }

    const ttl = getTTL(targetUrl);
    const hasKV = env && env.WF_CACHE;

    // 1. Lecture du cache partagé KV (sauf contournement)
    if (hasKV && !bypass) {
      const hit = await env.WF_CACHE.getWithMetadata(targetUrl, { type: 'text' });
      if (hit.value !== null) {
        return new Response(hit.value, {
          status: 200,
          headers: {
            ...CORS,
            'Content-Type': (hit.metadata && hit.metadata.ct) || 'application/json',
            'X-WF-Cache': 'HIT'
          }
        });
      }
    }

    // 2. Cache manquant/expiré : on va chercher à la source
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      return json({ error: `Erreur proxy Cloudflare: ${err.message}` }, 502);
    }

    const contentType = upstream.headers.get('content-type') || 'application/json';

    // On ne met en cache que les réponses réussies
    if (upstream.status === 200) {
      const body = await upstream.text();
      if (hasKV) {
        // expirationTtl gère l'expiration automatiquement (pas de timestamp à stocker)
        await env.WF_CACHE.put(targetUrl, body, {
          expirationTtl: Math.max(60, ttl),
          metadata: { ct: contentType }
        });
      }
      return new Response(body, {
        status: 200,
        headers: { ...CORS, 'Content-Type': contentType, 'X-WF-Cache': 'MISS' }
      });
    }

    // Erreur distante : on transmet sans cacher
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { ...CORS, 'Content-Type': contentType }
    });
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
