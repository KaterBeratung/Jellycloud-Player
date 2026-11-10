// Vollbild im Player (JC_DEV=1, JC_FAKE_MPV=1): das Steuerungs-Fenster (Overlay) muss den Bildschirm ganz bedecken, sonst blendet Windows die Taskleiste nicht ganz aus und es bleibt
// ein 1 bis 2 Bildpunkte hoher grauer Streifen am unteren Rand stehen (im Video erst sichtbar, wenn die Leiste nach ein paar Sekunden ausblendet).
// Gemessen wird nativ: GetWindowRect (Bildpunkte, per PowerShell mit DPI-Bewusstsein) von Host, Overlay und Bildschirm.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { server, items } = require('../mock-server');

const PS = String.raw`
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT mon; public RECT work; public int flags; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI mi);
}
'@
[W]::SetProcessDPIAware() | Out-Null
$o = @{}
foreach ($k in 'hostH', 'overlayH') {
  $h = [IntPtr][long](Get-Variable $k).Value
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $o[$k.Replace('H', '')] = @{ l = $r.L; t = $r.T; r = $r.R; b = $r.B }
}
$mi = New-Object W+MI
$mi.cb = [Runtime.InteropServices.Marshal]::SizeOf($mi)
[W]::GetMonitorInfo([W]::MonitorFromWindow([IntPtr][long]$hostH, 2), [ref]$mi) | Out-Null
$o['monitor'] = @{ l = $mi.mon.L; t = $mi.mon.T; r = $mi.mon.R; b = $mi.mon.B }
$o | ConvertTo-Json -Compress -Depth 4
`;

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const player = ctx.player;
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const hwnd = (win) => String(win.getNativeWindowHandle().readBigUInt64LE(0));
  const rects = () => {
    const script = `$hostH = ${hwnd(player.host)}\n$overlayH = ${hwnd(player.overlay)}\n${PS}`;
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { encoding: 'utf8', windowsHide: true }).trim());
  };

  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', startTicks: ${60 * 1e7}, resume: false })`);
  check('Wiedergabe gestartet', await waitFor(() => player.state.phase === 'playing'));
  await ctx.wait(800);

  // ---------- Fenster: kein Rand ----------
  const w0 = rects();
  const d = (a, b) => ({ l: a.l - b.l, t: a.t - b.t, r: a.r - b.r, b: a.b - b.b });
  const win = d(w0.overlay, w0.host);
  check('Im Fenster deckt das Overlay die Flaeche des Hosts (kein Rand, hoechstens die Fensterkante)', Math.abs(win.l) < 20 && Math.abs(win.r) < 20 && Math.abs(win.b) < 20 && win.t >= 0, JSON.stringify(win));

  // ---------- Vollbild ----------
  player.host.setFullScreen(true);
  check('Vollbild ist an', await waitFor(() => player.host.isFullScreen() && player.state.fullscreen === true));
  await ctx.wait(900); // die Nachziehungen (sofort, +80 ms, +300 ms) sind durch
  const w1 = rects();
  const m = w1.monitor;
  console.log(`  Bildschirm ${m.r - m.l}x${m.b - m.t}, Host ${JSON.stringify(w1.host)}, Overlay ${JSON.stringify(w1.overlay)}`);
  const gap = d(m, w1.overlay); // positiv links/oben = Overlay beginnt nach dem Bildschirm; negativ rechts/unten = endet davor
  const covers = w1.overlay.l <= m.l && w1.overlay.t <= m.t && w1.overlay.r >= m.r && w1.overlay.b >= m.b;
  check('Vollbild: das Overlay bedeckt den ganzen Bildschirm', covers, JSON.stringify(gap));
  const margins = { left: m.l - w1.overlay.l, top: m.t - w1.overlay.t, right: w1.overlay.r - m.r, bottom: w1.overlay.b - m.b };
  check('Vollbild: ringsum mindestens ein Bildpunkt Reserve (gegen Rundung bei gebrochener Skalierung)', Object.values(margins).every((v) => v >= 1), JSON.stringify(margins));
  check('Vollbild: der Host selbst bedeckt den Bildschirm', w1.host.l <= m.l && w1.host.t <= m.t && w1.host.r >= m.r && w1.host.b >= m.b, JSON.stringify(w1.host));
  await ctx.capture(path.join(out, 'FS-01-vollbild.png'), player.overlay);

  // Auch nach Minuten bleibt es so: erneutes Angleichen (Groessenaenderung, Fokus) aendert nichts
  player.host.emit('resize');
  await ctx.wait(400);
  const w2 = rects();
  check('Nach erneutem Angleichen unveraendert', JSON.stringify(w2.overlay) === JSON.stringify(w1.overlay), JSON.stringify(w2.overlay));

  // ---------- zurueck ins Fenster ----------
  player.host.setFullScreen(false);
  check('Vollbild ist aus', await waitFor(() => !player.host.isFullScreen() && player.state.fullscreen === false));
  await ctx.wait(900);
  const w3 = rects();
  const back = d(w3.overlay, w3.host);
  check('Zurueck im Fenster: wieder ohne Rand', Math.abs(back.l) < 20 && Math.abs(back.r) < 20 && Math.abs(back.b) < 20 && back.t >= 0 && w3.overlay.r - w3.overlay.l < w3.monitor.r - w3.monitor.l + 4, JSON.stringify(back));

  await player.overlay.webContents.executeJavaScript(`window.player.send({ type: 'close' })`).catch(() => {});
  await waitFor(() => !player.mpv && !player.host);
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
