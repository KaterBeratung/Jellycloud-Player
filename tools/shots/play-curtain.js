// Klick auf "Abspielen": wie lange bleibt die Oberflaeche (Hintergrundbild der Detailseite) noch sichtbar, bevor Schwarz bzw. das Video kommt?
// Mit ECHTEM mpv (JC_FAKE_MPV NICHT setzen). Zwei Messungen ab dem Klick, ohne den Bildschirm auszulesen (das geht ohne angemeldete Sitzung nicht):
//   1. Seitenaufnahme der Oberflaeche (capturePage) alle ~30 ms: ab wann ist sie dunkel (Vorhang)?
//   2. Windows-Fensterliste: ab wann gibt es ein sichtbares mpv-Kindfenster im Hauptfenster (davor sieht man bei fehlendem Vorhang die Oberflaeche)?
//   Start: $env:JC_DEV='1'; electron . --user-data-dir=<tmp> --shots=tools/shots/play-curtain.js
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { server, items } = require('../mock-server');

// Meldet (Unix-ms) den ersten Moment, in dem das Hauptfenster ein sichtbares Kindfenster der Klasse "mpv" hat
const WATCHER = `
param($hwnd, $dur)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static bool HasMpv(long host) {
    bool found = false;
    EnumChildWindows(new IntPtr(host), (h, l) => { var s = new StringBuilder(64); GetClassName(h, s, 64); if (s.ToString() == "mpv" && IsWindowVisible(h)) found = true; return !found; }, IntPtr.Zero);
    return found;
  }
}
'@
[Console]::Out.WriteLine('bereit')
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt [int]$dur) {
  if ([W]::HasMpv([long]$hwnd)) { [Console]::Out.WriteLine('mpv ' + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).ToString()); break }
  Start-Sleep -Milliseconds 10
}
`;

function watchMpv(hwnd, ms) {
  const file = path.join(os.tmpdir(), `jc-watch-${process.pid}.ps1`);
  fs.writeFileSync(file, WATCHER, 'utf8');
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, String(hwnd), String(ms)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (d) => (buf += d));
  child.stderr.on('data', () => {}); // nie ungelesen lassen: ein voller Puffer wuerde das Skript anhalten
  let ready;
  const isReady = new Promise((r) => (ready = r));
  child.stdout.on('data', () => /bereit/.test(buf) && ready());
  const finished = new Promise((r) => child.on('close', r));
  const kill = setTimeout(() => child.kill(), ms + 4000);
  return {
    ready: isReady,
    done: async () => {
      await finished;
      clearTimeout(kill);
      fs.rmSync(file, { force: true });
      const m = /mpv (\d+)/.exec(buf);
      return m ? Number(m[1]) : null;
    }
  };
}

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
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
  const win = ctx.win;
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const waitFor = async (fn, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(50);
    }
    return false;
  };
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();

  /** Mittlere Helligkeit der Oberflaeche (grosse Schritte reichen: Schwarz = 0, Detailseite mit Hintergrundbild deutlich heller). */
  const brightness = async () => {
    const img = (await win.webContents.capturePage()).resize({ width: 96 });
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    let sum = 0;
    for (let i = 0; i < width * height; i++) sum += Math.max(bmp[i * 4], bmp[i * 4 + 1], bmp[i * 4 + 2]);
    return sum / (width * height);
  };

  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await waitFor(() => ctx.run(`!!document.querySelector('.detail-actions .btn.primary')`));
  await ctx.wait(1800); // Seite fertig eingeblendet

  const round = async (label) => {
    const watcher = watchMpv(hwnd, 9000);
    await watcher.ready;
    await ctx.wait(300);
    const ref = await brightness();
    const clickAt = Date.now();
    const log = [];
    const onActive = (on) => log.push(`active=${on}@${Date.now() - clickAt}`);
    const onClosed = () => log.push(`closed@${Date.now() - clickAt}`);
    player.on('active', onActive);
    player.on('closed', onClosed);
    // "Von vorn": der Testfilm laeuft nur 60 s, die gemerkte Position des Mock-Eintrags liegt dahinter ("Fortsetzen" wuerde sofort enden)
    await ctx.run(`[...document.querySelectorAll('.detail-actions .btn')].find((b) => /Von vorn|From start/.test(b.textContent))?.click() ?? document.querySelector('.detail-actions .btn.primary').click()`);
    const series = [];
    while (Date.now() - clickAt < 1800) {
      const b = await brightness();
      series.push({ ms: Date.now() - clickAt, ratio: ref ? b / ref : 0 });
    }
    const started = await waitFor(() => player.state?.phase === 'playing', 9000);
    const mpvAt = await watcher.done();
    player.off('active', onActive);
    player.off('closed', onClosed);
    const toast = await ctx.run(`document.querySelector('#toasts')?.innerText ?? ''`).catch(() => '');
    console.log(`[${label}] Ereignisse: ${log.join(' ')}; phase=${player.state?.phase} fehler=${player.state?.error ?? '-'} meldung="${String(toast).replace(/\s+/g, ' ')}"`);
    const cover = series.find((p) => p.ratio < 0.35);
    const mpvMs = mpvAt ? mpvAt - clickAt : null;
    console.log(`[${label}] Bezug ${ref.toFixed(0)}; mpv-Fenster sichtbar nach ${mpvMs ?? 'nie'} ms; ms:Anteil% ${series.map((p) => `${p.ms}:${Math.round(p.ratio * 100)}`).join(' ')}`);
    return { started, ref, cover, mpvMs };
  };

  const r1 = await round('Klick 1');
  check('Wiedergabe startet (echter mpv)', r1.started);
  check('Detailseite ist hell genug fuer die Messung', r1.ref >= 15, r1.ref.toFixed(0));
  console.log(`INFO  Ohne Vorhang ist die Oberflaeche sichtbar, bis das mpv-Fenster da ist: ${r1.mpvMs ?? '?'} ms`);
  check('Nach dem Klick ist die Oberflaeche in hoechstens 250 ms dunkel (Vorhang statt Hintergrundbild)', !!r1.cover && r1.cover.ms <= 250, r1.cover ? `${r1.cover.ms} ms` : 'nie dunkel geworden');
  check('...und vor dem mpv-Fenster (keine Luecke dazwischen)', !!r1.cover && (r1.mpvMs === null || r1.cover.ms <= r1.mpvMs), `Vorhang ${r1.cover?.ms ?? '-'} ms, mpv ${r1.mpvMs ?? '-'} ms`);

  // Beim Schliessen kommt die Oberflaeche zurueck (kein haengender schwarzer Vorhang)
  await player.stop();
  await waitFor(() => !player.mpv && !player.overlay, 6000);
  await ctx.wait(700);
  const back = await brightness();
  check('Nach dem Schliessen ist die Oberflaeche wieder sichtbar (Vorhang ausgeblendet)', r1.ref > 0 && back / r1.ref > 0.8, `${back.toFixed(0)} gegen Bezug ${r1.ref.toFixed(0)}`);
  check('Der Vorhang liegt nicht mehr ueber der Seite (keine Klicksperre)', await ctx.run(`getComputedStyle(document.querySelector('#play-curtain')).pointerEvents === 'none'`));

  // Zweiter Klick: derselbe Ablauf noch einmal
  const r2 = await round('Klick 2');
  check('Zweiter Klick: wieder in hoechstens 250 ms dunkel', r2.started && !!r2.cover && r2.cover.ms <= 250, r2.cover ? `${r2.cover.ms} ms` : 'nie dunkel geworden');
  await player.stop();
  await waitFor(() => !player.mpv && !player.overlay, 6000);

  server.close();
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  if (pass !== results.length) process.exitCode = 1;
};
