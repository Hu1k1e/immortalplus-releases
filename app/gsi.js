/**
 * Local Game State Integration relay + one-click installer.
 *
 * Dota posts its game state to http://127.0.0.1:<port>/ (so the cfg file never
 * has to change, and works regardless of the server's address or HTTPS); this
 * relay forwards each payload to the Immortal+ backend. Payloads are queued
 * and sent one at a time, so a slow or briefly unreachable server never blocks
 * the game's own posting.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BODY = 2 * 1024 * 1024;
const MAX_QUEUE = 6;

class GsiForwarder {
  constructor(getBackendUrl) {
    this.getBackendUrl = getBackendUrl;
    this.server = null;
    this.port = null;
    this.queue = [];
    this.sending = false;
    this.lastForwardAt = 0;
    this.lastError = null;
    this.forwarded = 0;
    this.lines = [];            // recent happenings, for Settings -> Logs
    this.lastReceivedAt = 0;
  }

  _log(text) {
    this.lines.push(`${new Date().toISOString()} ${text}`);
    if (this.lines.length > 200) this.lines.shift();
  }

  recentLog(n = 60) { return this.lines.slice(-n); }

  async start(preferredPort) {
    for (let port = preferredPort; port < preferredPort + 12; port++) {
      try {
        await this._listen(port);
        this.port = port;
        this._log(`Game-data relay listening on 127.0.0.1:${port}.`);
        return port;
      } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error('No free port for the local game-data relay');
  }

  _listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._handle(req, res));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        server.on('error', (e) => { this.lastError = e.message; });
        this.server = server;
        resolve();
      });
    });
  }

  _handle(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Immortal+ game-data relay');
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      // Answer at once -- Dota shouldn't wait on the network round trip.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      const body = Buffer.concat(chunks).toString('utf8');
      if (body) {
        const now = Date.now();
        if (now - this.lastReceivedAt > 20000) this._log(this.lastReceivedAt ? 'Dota is sending game data again.' : 'Dota started sending game data.');
        this.lastReceivedAt = now;
        this._enqueue(body);
      }
    });
    req.on('error', () => {});
  }

  _enqueue(body) {
    this.queue.push(body);
    // Under pressure keep the newest state; older ticks are superseded.
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    this._pump();
  }

  async _pump() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const body = this.queue.shift();
        const backend = this.getBackendUrl();
        if (!backend) { this.lastError = 'No backend configured'; continue; }
        try {
          const resp = await fetch(`${backend}/api/gsi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(4000),
          });
          if (!resp.ok) throw new Error(`Server answered ${resp.status}`);
          if (this.lastError) this._log('Forwarding to the backend works again.');
          this.lastForwardAt = Date.now();
          this.lastError = null;
          this.forwarded += 1;
        } catch (e) {
          if (this.lastError !== e.message) this._log(`Could not forward game data to the backend: ${e.message}`);
          this.lastError = e.message;
        }
      }
    } finally {
      this.sending = false;
    }
  }

  status() {
    return {
      port: this.port,
      forwarded: this.forwarded,
      lastForwardAgeS: this.lastForwardAt ? Math.round((Date.now() - this.lastForwardAt) / 1000) : null,
      lastError: this.lastError,
    };
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
  }
}

/* ── finding Dota 2 ──────────────────────────────────────────────────── */

function regQuerySteamPath() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout);
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null);
    });
  });
}

async function steamLibraries() {
  const roots = [];
  const steam = process.env.IMMORTAL_STEAM_PATH || (await regQuerySteamPath()) || 'C:\\Program Files (x86)\\Steam';
  roots.push(steam);
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(m[1].replace(/\\\\/g, '\\'));
  } catch {
    /* no library list -- the main Steam folder is all we have */
  }
  return [...new Set(roots)];
}

/** Absolute path of "<library>/steamapps/common/dota 2 beta", or null. */
async function findDotaDir() {
  if (process.env.IMMORTAL_DOTA_DIR) return process.env.IMMORTAL_DOTA_DIR;
  for (const lib of await steamLibraries()) {
    const dir = path.join(lib, 'steamapps', 'common', 'dota 2 beta');
    if (fs.existsSync(path.join(dir, 'game', 'dota'))) return dir;
  }
  return null;
}

const CFG_NAME = 'gamestate_integration_immortalplus.cfg';

function fallbackConfig(uri) {
  const blocks = ['provider', 'map', 'player', 'hero', 'abilities', 'items', 'draft', 'events', 'buildings', 'minimap', 'neutralitems', 'couriers', 'roshan'];
  return [
    '"Immortal+ Coach"', '{',
    `    "uri"           "${uri}"`,
    '    "timeout"       "5.0"', '    "buffer"        "0.1"', '    "throttle"      "0.5"', '    "heartbeat"     "5.0"',
    '    "data"', '    {', ...blocks.map((b) => `        "${b}"${' '.repeat(Math.max(1, 14 - b.length))}"1"`), '    }', '}',
  ].join('\n');
}

async function fetchConfigFromBackend(backendUrl, uri) {
  try {
    const resp = await fetch(`${backendUrl}/api/gsi/config?uri=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data && typeof data.config === 'string') return data.config;
    }
  } catch {
    /* fall through to the built-in template */
  }
  return fallbackConfig(uri);
}

async function installGsi(backendUrl, port) {
  const dota = await findDotaDir();
  if (!dota) return { ok: false, error: 'Could not find your Dota 2 folder. Install the config by hand from the setup guide.' };
  const uri = `http://127.0.0.1:${port}/`;
  const dir = path.join(dota, 'game', 'dota', 'cfg', 'gamestate_integration');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, CFG_NAME);
    fs.writeFileSync(file, await fetchConfigFromBackend(backendUrl, uri), 'utf8');
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function gsiInstallState(configuredPath, port) {
  if (!configuredPath || !fs.existsSync(configuredPath)) return { installed: false, path: null, matches: false };
  let matches = false;
  try { matches = fs.readFileSync(configuredPath, 'utf8').includes(`127.0.0.1:${port}`); } catch { /* unreadable */ }
  return { installed: true, path: configuredPath, matches };
}

module.exports = { GsiForwarder, installGsi, findDotaDir, gsiInstallState, CFG_NAME };
