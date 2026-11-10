'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

/**
 * Haelt das mpv-Fenster ganz oben in der Z-Reihenfolge der Kindfenster des Host-Fensters.
 *
 * Hintergrund: Chromiums GPU-Prozess haengt an jedes Electron-Fenster ein Kindfenster ("Intermediate D3D Window").
 * Liegt es ueber dem eingebetteten mpv-Fenster, bleibt das Video schwarz. Ohne Native-Modul erledigt das ein kleiner,
 * dauerhaft laufender PowerShell-Helfer, der nur auf Kommandos wartet ("raise <hwnd>") und nichts tut, wenn mpv schon oben liegt.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class Z {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  public static string Raise(long host) {
    IntPtr hostH = new IntPtr(host);
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(hostH, delegate(IntPtr h, IntPtr l) {
      StringBuilder sb = new StringBuilder(32);
      GetClassName(h, sb, 32);
      if (sb.ToString() == "mpv") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "nomatch";
    if (GetWindow(hostH, 5) == found) return "ok " + found;
    SetWindowPos(found, IntPtr.Zero, 0, 0, 0, 0, 0x13);
    return "raised " + found;
  }
}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -match '^raise (\d+)$') { [Console]::Out.WriteLine([Z]::Raise([long]$Matches[1])) }
  elseif ($line -eq 'quit') { break }
  [Console]::Out.Flush()
}
`;

class MpvZOrder extends EventEmitter {
  /** @param {string|number|bigint} hostHwnd HWND des Host-Fensters (dezimal) */
  constructor(hostHwnd, { spawnImpl = spawn } = {}) {
    super();
    this.hwnd = String(hostHwnd);
    this.spawnImpl = spawnImpl;
    this.proc = null;
    this.ready = false;
    this.lastResult = null;
    this.timer = null;
    this.buffer = '';
  }

  start() {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    this.proc = this.spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.buffer += d;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (line === 'ready') {
          this.ready = true;
          this.raise();
        } else if (line) {
          this.lastResult = line;
          this.emit('result', line);
        }
      }
    });
    this.proc.on('error', () => {});
    this.proc.on('exit', () => {
      this.ready = false;
      this.proc = null;
    });
    this.proc.stdin.on('error', () => {});
    // Anfangs schnell (mpv-Fenster entsteht erst nach dem Start), danach als Waechter im Sekundentakt.
    let fast = 0;
    this.timer = setInterval(() => {
      this.raise();
      fast++;
      if (fast === 30) {
        clearInterval(this.timer);
        this.timer = setInterval(() => this.raise(), 1000);
        this.timer.unref?.();
      }
    }, 150);
    this.timer.unref?.();
    return this;
  }

  raise() {
    if (this.ready && this.proc?.stdin.writable) this.proc.stdin.write(`raise ${this.hwnd}\n`);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    try {
      this.proc?.stdin.write('quit\n');
      this.proc?.stdin.end();
    } catch {
      /* Prozess ist schon weg */
    }
    const p = this.proc;
    setTimeout(() => p?.kill(), 1500).unref?.();
  }
}

module.exports = { MpvZOrder, SCRIPT };
