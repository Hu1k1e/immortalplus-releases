/**
 * Finds which monitor Dota 2 is on, so the overlay can follow the game.
 *
 * This is an ordinary operating-system window query (the same one a window
 * manager or screenshot tool makes: "where is the window titled Dota 2?"). It
 * never touches the game's process or memory.
 *
 * One long-lived PowerShell helper answers a line on stdin with the window's
 * pixel rectangle on stdout, so asking every few seconds costs almost nothing.
 */
const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DotaFinder {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct RECT { public int L, T, R, B; }
  public static string Find() {
    string res = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      // The game window is titled "Dota 2" with the SDL window class; the class
      // check keeps an Explorer folder or browser tab with that name from matching.
      if (sb.ToString() == "Dota 2" && cls.ToString() == "SDL_app") {
        RECT r; GetWindowRect(h, out r);
        long started = 0;
        try {
          uint pid; GetWindowThreadProcessId(h, out pid);
          var t = System.Diagnostics.Process.GetProcessById((int)pid).StartTime.ToUniversalTime();
          started = (long)(t - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        } catch { }
        res = r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T) + "," + started;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@
[DotaFinder]::SetProcessDPIAware() | Out-Null
while (($line = [Console]::In.ReadLine()) -ne $null) {
  [Console]::Out.WriteLine([DotaFinder]::Find())
  [Console]::Out.Flush()
}
`;

function parseRect(line) {
  const m = /^(-?\d+),(-?\d+),(\d+),(\d+)(?:,(\d+))?$/.exec(String(line || '').trim());
  if (!m) return null;
  const [x, y, width, height, started] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  return width > 0 && height > 0 ? { x, y, width, height, startedAt: started || null } : null;
}

class DotaLocator {
  constructor() {
    this.child = null;
    this.waiting = null;   // resolver of the in-flight query
    this.buffer = '';
    this.broken = false;
  }

  _start() {
    if (this.child || this.broken || process.platform !== 'win32') return;
    try {
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      });
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let i;
        while ((i = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, i);
          this.buffer = this.buffer.slice(i + 1);
          if (this.waiting) { const done = this.waiting; this.waiting = null; done(parseRect(line)); }
        }
      });
      const gone = () => {
        this.child = null;
        if (this.waiting) { const done = this.waiting; this.waiting = null; done(null); }
      };
      this.child.on('exit', gone);
      this.child.on('error', () => { this.broken = true; gone(); });
    } catch {
      this.broken = true;
      this.child = null;
    }
  }

  /** Resolves with the Dota window's rectangle in physical pixels, or null. */
  locate(timeoutMs = 4000) {
    this._start();
    if (!this.child || this.waiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { if (this.waiting === done) this.waiting = null; resolve(null); }, timeoutMs);
      const done = (rect) => { clearTimeout(timer); resolve(rect); };
      this.waiting = done;
      try { this.child.stdin.write('q\n'); } catch { this.waiting = null; clearTimeout(timer); resolve(null); }
    });
  }

  stop() {
    if (this.child) { try { this.child.kill(); } catch { /* already gone */ } }
    this.child = null;
  }
}

module.exports = { DotaLocator, parseRect };
