/**
 * Runs the screen scanner (desktop/scanner, a Python program shipped inside the
 * installer as scanner/draft-scanner.exe) as a background child process of the app:
 * it reads draft picks/bans and enemy items off the Dota window and reports them to
 * the backend. The app starts it with the backend address and settings, restarts it if
 * it dies, and stops it (and everything it spawned) on quit, so there is nothing
 * separate for the user to download, launch or configure.
 *
 * It only reads pixels of the Dota window, the same as a screenshot tool.
 */
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LOG_LINES = 300;
const LOG_FILE_LIMIT = 1024 * 1024;
const STABLE_AFTER_MS = 60 * 1000;      // running this long counts as healthy and resets the back-off
const MAX_BACKOFF_MS = 30 * 1000;

class ScannerManager {
  /**
   * @param {object} opts
   * @param {() => string} opts.getBackendUrl
   * @param {() => object} opts.getConfig       reads scannerEnabled / hudScale
   * @param {() => ({command: string, args?: string[], env?: object} | null)} opts.resolveCommand
   * @param {string} opts.logPath               where the scanner's output is also written
   */
  constructor({ getBackendUrl, getConfig, resolveCommand, logPath }) {
    this.getBackendUrl = getBackendUrl;
    this.getConfig = getConfig;
    this.resolveCommand = resolveCommand;
    this.logPath = logPath;
    this.child = null;
    this.startedAt = 0;
    this.restarts = 0;
    this.backoff = 2000;
    this.timer = null;
    this.stopping = false;
    this.lines = [];
    this.available = true;
    this._rotateLog();
  }

  _rotateLog() {
    try {
      if (fs.existsSync(this.logPath) && fs.statSync(this.logPath).size > LOG_FILE_LIMIT) fs.renameSync(this.logPath, `${this.logPath}.old`);
    } catch { /* logging is best effort */ }
  }

  _log(text) {
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      this.lines.push(line);
      if (this.lines.length > MAX_LOG_LINES) this.lines.shift();
      try { fs.appendFileSync(this.logPath, `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
    }
  }

  get running() { return !!this.child; }

  status() {
    const cfg = this.getConfig();
    return {
      available: this.available,
      enabled: cfg.scannerEnabled !== false,
      running: this.running,
      hudScale: Number(cfg.hudScale) || 1,
      restarts: this.restarts,
      lastLine: this.lines[this.lines.length - 1] || '',
    };
  }

  recentLog(n = 60) { return this.lines.slice(-n); }

  /**
   * Once per app run, before our own scanner starts: ends any draft-scanner.exe left behind by an
   * earlier run (a crash, an update, a force-quit) so two never scan the screen at the same time.
   */
  _cleanStale() {
    if (this.cleaned || process.platform !== 'win32' || process.env.IMMORTAL_SCANNER_CMD) return;
    this.cleaned = true;
    try {
      const r = require('child_process').spawnSync('taskkill', ['/IM', 'draft-scanner.exe', '/T', '/F'], { windowsHide: true, timeout: 8000 });
      if (r.status === 0) this._log('Ended a screen scanner left running from an earlier session.');
    } catch { /* nothing to clean, or not allowed to */ }
  }

  /** Starts the scanner if it is enabled, there is a backend address and the program exists. */
  start() {
    clearTimeout(this.timer);
    this.stopping = false;
    if (this.child) return;
    const cfg = this.getConfig();
    const backend = this.getBackendUrl();
    if (cfg.scannerEnabled === false || !backend) return;

    const cmd = this.resolveCommand();
    if (!cmd) {
      this.available = false;
      this._log('The screen scanner is not part of this build, so it was not started.');
      return;
    }
    this.available = true;
    this._cleanStale();

    const env = {
      ...process.env,
      ...(cmd.env || {}),
      IMMORTALPLUS_BACKEND_URL: backend,         // so the scanner never asks for it
      DOTA_HUD_SCALE: String(Number(cfg.hudScale) || 1),
      IMMORTALPLUS_PARENT_PID: String(process.pid),   // the scanner exits by itself if the app is gone
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    try {
      this.child = spawn(cmd.command, cmd.args || [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this._log(`Could not start the screen scanner: ${e.message}`);
      this.child = null;
      this._scheduleRestart();
      return;
    }
    const child = this.child;
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }   // never compete with the game
    this.startedAt = Date.now();
    this._log(`Screen scanner started (pid ${child.pid}).`);
    child.stdout.on('data', (d) => this._log(d));
    child.stderr.on('data', (d) => this._log(d));
    child.on('error', (e) => this._log(`Screen scanner error: ${e.message}`));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this._log(`Screen scanner stopped (${signal || `code ${code}`}).`);
      if (Date.now() - this.startedAt > STABLE_AFTER_MS) { this.backoff = 2000; this.restarts = 0; }
      if (!this.stopping) this._scheduleRestart();
    });
  }

  _scheduleRestart() {
    if (this.stopping || this.getConfig().scannerEnabled === false) return;
    this.restarts += 1;
    this._log(`Restarting the screen scanner in ${Math.round(this.backoff / 1000)}s.`);
    this.timer = setTimeout(() => this.start(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  /** Stops the scanner and everything it started (a packaged Python program runs as two processes). */
  stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    const child = this.child;
    this.child = null;
    if (!child || !child.pid) return Promise.resolve();
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve());
      } else {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        resolve();
      }
    });
  }

  async restart() {
    await this.stop();
    this.backoff = 2000;
    this.restarts = 0;
    this.start();
  }
}

/** Where the scanner program lives: inside the installed app, or the dev build next to the source. */
function defaultResolveCommand(app) {
  return () => {
    if (process.env.IMMORTAL_SCANNER_CMD) {
      // Tests substitute a stand-in program: a JSON {command, args, env}.
      try { return JSON.parse(process.env.IMMORTAL_SCANNER_CMD); } catch { return null; }
    }
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'scanner', 'draft-scanner.exe')]
      : [path.join(__dirname, '..', 'scanner', 'dist', 'draft-scanner.exe')];
    const found = candidates.find((p) => fs.existsSync(p));
    return found ? { command: found } : null;
  };
}

module.exports = { ScannerManager, defaultResolveCommand };
