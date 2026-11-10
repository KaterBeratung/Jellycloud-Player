// Diagnose der Einbettung: rendert mpv? Wo liegen die Kindfenster? Verdeckt das Overlay das Video?
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { screen } = require('electron');
const { server, items } = require('../mock-server');

const PS_CHILDREN = (hwnd) => `
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> Children(IntPtr p) {
    var o = new List<string>();
    EnumChildWindows(p, (h, l) => { var s = new StringBuilder(256); GetClassName(h, s, 256); RECT r; GetWindowRect(h, out r); uint pid; GetWindowThreadProcessId(h, out pid); o.Add(s + " hwnd=" + h + " parent=" + GetParent(h) + " pid=" + pid + " visible=" + IsWindowVisible(h) + " rect=" + r.L + "," + r.T + " " + (r.R - r.L) + "x" + (r.B - r.T)); return true; }, IntPtr.Zero);
    return o;
  }
}
'@
[W]::SetProcessDPIAware() | Out-Null
[W]::Children([IntPtr]${hwnd}) | ForEach-Object { $_ }
`;

function grab(file, win) {
  const r = screen.dipToScreenRect(win, win.getBounds());
  const ps = [
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class D { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); }'",
    '[D]::SetProcessDPIAware() | Out-Null',
    'Add-Type -AssemblyName System.Drawing',
    `$b = New-Object System.Drawing.Bitmap(${r.width},${r.height})`,
    '$g = [System.Drawing.Graphics]::FromImage($b)',
    `$g.CopyFromScreen(${r.x},${r.y},0,0,$b.Size)`,
    `$b.Save('${file.replace(/'/g, "''")}')`,
    '$g.Dispose(); $b.Dispose()'
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
}

const app_pids = () => require('electron').app.getAppMetrics().map((m) => `${m.type}:${m.pid}`).join(' ');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.config.updateSettings({ player: { volume: 8 } });
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: 0 })`);
  const p = ctx.player;
  for (let i = 0; i < 60 && p.state.phase !== 'playing'; i++) await ctx.wait(150);
  p.host.setAlwaysOnTop(true);
  p.host.moveTop();
  await ctx.wait(3000);

  const h = p.host.getNativeWindowHandle().readBigUInt64LE(0);
  const o = p.overlay.getNativeWindowHandle().readBigUInt64LE(0);
  console.log(`Host-HWND ${h}  Overlay-HWND ${o}`);
  console.log('--- Kindfenster des Hosts (oberstes zuerst) ---');
  console.log(spawnSync('powershell', ['-NoProfile', '-Command', PS_CHILDREN(h)], { encoding: 'utf8' }).stdout.trim());
  console.log('PIDs: App(main)=' + process.pid + '  mpv=' + p.mpv.proc.pid + '  GPU/Renderer:', app_pids());
  console.log('Host-Bounds:', JSON.stringify(p.host.getBounds()), 'Content:', JSON.stringify(p.host.getContentBounds()));
  console.log('mpv osd-dimensions:', await p.mpv.getProperty('osd-width'), 'x', await p.mpv.getProperty('osd-height'), ' vo-configured:', await p.mpv.getProperty('vo-configured'));
  await p.mpv.command('screenshot-to-file', path.join(out, 'D-01-mpv-own-screenshot.png'), 'video');
  await ctx.wait(500);
  console.log('mpv-Screenshot geschrieben:', fs.existsSync(path.join(out, 'D-01-mpv-own-screenshot.png')));

  p.overlay.hide();
  await ctx.wait(800);
  grab(path.join(out, 'D-02-host-overlay-hidden.png'), p.host);

  // Hypothese: mpv-Fenster per SetWindowPos(HWND_TOP) nach oben holen -> Video wird sichtbar
  const raise = `
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class R {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  public static string RaiseMpv(IntPtr host) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(host, (h, l) => { var s = new StringBuilder(64); GetClassName(h, s, 64); if (s.ToString() == "mpv") found = h; return true; }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "mpv-Fenster nicht gefunden";
    bool ok = SetWindowPos(found, IntPtr.Zero, 0, 0, 0, 0, 0x13);
    return "mpv-HWND " + found + " SetWindowPos=" + ok + " err=" + Marshal.GetLastWin32Error();
  }
}
'@
[R]::RaiseMpv([IntPtr]${h})`;
  console.log('Raise:', spawnSync('powershell', ['-NoProfile', '-Command', raise], { encoding: 'utf8' }).stdout.trim().replace(/\r?\n/g, ' | '));
  await ctx.wait(800);
  console.log('Kinder nach dem Anheben:', spawnSync('powershell', ['-NoProfile', '-Command', PS_CHILDREN(h)], { encoding: 'utf8' }).stdout.trim().replace(/\r?\n/g, ' | '));
  grab(path.join(out, 'D-04-after-raise-overlay-hidden.png'), p.host);
  p.overlay.showInactive();
  await ctx.wait(800);
  grab(path.join(out, 'D-03-host-overlay-visible.png'), p.host);

  await p.stop();
  server.close();
};
