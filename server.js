const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8088;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const CACHE_FILE = path.join(__dirname, 'cache.json');
let cache = {};

// Supprimer les entrées expirées du cache
function cleanExpiredCache() {
  const now = Date.now();
  let deletedCount = 0;
  for (const urlKey in cache) {
    const ttl = getTTL(urlKey);
    if (now - cache[urlKey].timestamp > ttl) {
      delete cache[urlKey];
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`[CACHE] Nettoyé ${deletedCount} entrées expirées`);
  }
}

// Déterminer la durée de validité (TTL) selon le type de requête
function getTTL(targetUrl) {
  // Le Worldstate change très souvent (cycle jour/nuit, fissures, etc.)
  if (targetUrl.includes('api.warframestat.us/pc')) {
    return 60 * 1000; // 1 minute
  }
  // Les prix / ordres en direct sur warframe.market : 5 minutes
  if (targetUrl.includes('api.warframe.market/v2/orders/item/') || targetUrl.includes('api.warframe.market/v1/items/')) {
    return 5 * 60 * 1000; // 5 minutes
  }
  // L'historique des prix relics.run, les tables de drops et reliques : 24 heures (données quasi statiques)
  if (targetUrl.includes('relics.run/history/') || 
      targetUrl.includes('drops.warframestat.us/data/') || 
      targetUrl.includes('api.warframestat.us/items')) {
    return 24 * 60 * 60 * 1000; // 24 heures
  }
  // Par défaut
  return 10 * 60 * 1000; // 10 minutes
}

// Charger le cache depuis le fichier s'il existe
try {
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`[CACHE] Chargé ${Object.keys(cache).length} entrées de ${CACHE_FILE}`);
    cleanExpiredCache();
  }
} catch (e) {
  console.error(`[CACHE] Impossible de charger le fichier cache : ${e.message}`);
}

// Sauvegarde asynchrone débouncée pour éviter les écritures disque intensives lors des scans en masse
let saveTimeout = null;
function queueSaveCache() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    cleanExpiredCache(); // Nettoyer avant de sauvegarder
    fs.writeFile(CACHE_FILE, JSON.stringify(cache), 'utf8', (err) => {
      if (err) {
        console.error(`[CACHE] Erreur d'écriture de cache.json : ${err.message}`);
      } else {
        console.log(`[CACHE] Sauvegardé avec succès dans ${CACHE_FILE}`);
      }
    });
  }, 2000); // 2 secondes de debounce
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Gérer la route du proxy
  if (pathname === '/proxy') {
    const targetUrlStr = parsedUrl.query.url;
    if (!targetUrlStr) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Paramètre "url" manquant.');
    }

    const decodedUrl = decodeURIComponent(targetUrlStr);

    // Sécurité : autoriser uniquement warframe.market, warframestat, drops.warframestat et relics.run
    if (!decodedUrl.startsWith('https://api.warframe.market/') && 
        !decodedUrl.startsWith('https://warframestat.us/') && 
        !decodedUrl.startsWith('https://drops.warframestat.us/') &&
        !decodedUrl.startsWith('https://api.warframestat.us/') &&
        !decodedUrl.startsWith('https://relics.run/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('URL non autorisée par le proxy.');
    }

    const now = Date.now();
    const ttl = getTTL(decodedUrl);
    const cached = cache[decodedUrl];
    const bypassCache = parsedUrl.query.nocache === '1';

    // Vérifier si la ressource est en cache et toujours valide (sauf si contournement demandé)
    if (!bypassCache && cached && (now - cached.timestamp < ttl)) {
      console.log(`[CACHE HIT] ${decodedUrl}`);
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': cached.contentType || 'application/json'
      });
      return res.end(cached.data);
    }

    console.log(`[CACHE MISS/EXPIRED] ${decodedUrl}`);
    https.get(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (targetRes) => {
      const contentType = targetRes.headers['content-type'] || 'application/json';
      
      if (targetRes.statusCode === 200) {
        let body = '';
        targetRes.on('data', chunk => { body += chunk; });
        targetRes.on('end', () => {
          // Mettre en cache la réponse réussie
          cache[decodedUrl] = {
            timestamp: Date.now(),
            contentType: contentType,
            data: body
          };
          queueSaveCache();

          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': contentType
          });
          res.end(body);
        });
      } else {
        // En cas d'erreur de l'API distante, on transmet la réponse sans la mettre en cache
        res.writeHead(targetRes.statusCode, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': contentType
        });
        targetRes.pipe(res);
      }
    }).on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Erreur proxy local: ${err.message}`);
    });
    return;
  }

  // 2. Détection automatique de EE.log
  if (pathname === '/api/read-log') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'LOCALAPPDATA non trouvé.' }));
    }

    const logPath = path.join(localAppData, 'Warframe', 'EE.log');

    fs.readFile(logPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Impossible de lire EE.log : ${err.message}` }));
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ content: data, path: logPath }));
    });
    return;
  }

  // 3. Servir les fichiers statiques
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Sécurité: empêcher la traversée de répertoires
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Accès interdit.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Fichier non trouvé.');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Erreur serveur: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Tracker Platine Warframe - Serveur Proxy Actif`);
  console.log(` Ouvrez votre navigateur sur :`);
  console.log(` 👉 http://localhost:${PORT}`);
  console.log(`==================================================`);
});
