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

    // Sécurité : autoriser uniquement warframe.market et warframestat
    if (!decodedUrl.startsWith('https://api.warframe.market/') && 
        !decodedUrl.startsWith('https://warframestat.us/') && 
        !decodedUrl.startsWith('https://drops.warframestat.us/') &&
        !decodedUrl.startsWith('https://api.warframestat.us/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('URL non autorisée par le proxy.');
    }

    https.get(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (targetRes) => {
      res.writeHead(targetRes.statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': targetRes.headers['content-type'] || 'application/json'
      });
      targetRes.pipe(res);
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

  // 2. Servir les fichiers statiques
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
