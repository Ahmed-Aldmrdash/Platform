'use strict';

// Optional HTTPS listener for the factory LAN: browsers only allow the
// microphone and push notifications on https (or localhost). Uses a
// self-signed certificate generated once into DATA_DIR/ssl.

const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config');

async function loadCertificate() {
  const dir = config.paths.SSL_DIR;
  const keyPath = path.join(dir, 'server.key');
  const certPath = path.join(dir, 'server.crt');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  }
  const selfsigned = require('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'hse-platform.local' }], { days: 3650, keySize: 2048, algorithm: 'sha256' });
  if (!pems.private || !pems.cert) throw new Error('certificate generation returned nothing');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert, 'utf8');
  return { key: pems.private, cert: pems.cert };
}

async function startHttps(app) {
  const credentials = await loadCertificate();
  return new Promise((resolve) => {
    const server = https.createServer(credentials, app).listen(config.https.port, () => {
      console.log(`HTTPS listening on port ${config.https.port} (self-signed certificate)`);
      resolve(server);
    });
  });
}

module.exports = { startHttps };
