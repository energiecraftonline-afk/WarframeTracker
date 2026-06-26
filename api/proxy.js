const https = require('https');

module.exports = (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).send('Paramètre "url" manquant.');
  }

  const decodedUrl = decodeURIComponent(url);

  // Sécurité : autoriser uniquement warframe.market et warframestat
  if (!decodedUrl.startsWith('https://api.warframe.market/') && 
      !decodedUrl.startsWith('https://warframestat.us/') && 
      !decodedUrl.startsWith('https://drops.warframestat.us/')) {
    return res.status(403).send('URL non autorisée par le proxy.');
  }

  https.get(decodedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  }, (targetRes) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', targetRes.headers['content-type'] || 'application/json');
    res.status(targetRes.statusCode);
    targetRes.pipe(res);
  }).on('error', (err) => {
    res.status(502).send(`Erreur proxy Vercel: ${err.message}`);
  });
};
