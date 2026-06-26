// --- SCRIPT DU CLOUDFLARE WORKER POUR LE PROXY CORS WARFRAME TRACKER ---
// 1. Créez un Worker gratuit sur le tableau de bord Cloudflare (https://dash.cloudflare.com)
// 2. Collez ce code dans l'éditeur de code de votre Worker
// 3. Déployez le Worker ("Save and deploy")
// 4. Copiez l'URL de votre Worker (ex: https://mon-proxy.mon-pseudo.workers.dev)
// 5. Collez cette URL dans la variable CLOUDFLARE_WORKER_URL en haut du fichier index.html (ou warframe-tracker.html)

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Gérer la requête de pré-vol CORS (Preflight request OPTIONS)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Paramètre "url" manquant.' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  // Sécurité : autoriser uniquement warframe.market et warframestat pour éviter que d'autres personnes n'utilisent votre proxy pour n'importe quoi
  if (!targetUrl.startsWith('https://api.warframe.market/') && 
      !targetUrl.startsWith('https://warframestat.us/') && 
      !targetUrl.startsWith('https://drops.warframestat.us/')) {
    return new Response(JSON.stringify({ error: 'URL non autorisée par le proxy.' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    })

    // Cloner la réponse pour lui ajouter l'en-tête CORS universel
    const newHeaders = new Headers(response.headers)
    newHeaders.set('Access-Control-Allow-Origin', '*')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: `Erreur proxy Cloudflare: ${err.message}` }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
