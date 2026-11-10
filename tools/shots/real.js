// End-to-End mit ECHTEM mpv (vendor\mpv\mpv.exe) und echtem Video ueber den Mock-Server (tools/sample/test.mkv).
// Start: $env:JC_DEV='1'; electron . --user-data-dir=<tmp> --shots=tools/shots/real.js   (JC_FAKE_MPV NICHT setzen)
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { screen } = require('electron');
const { server, items, state } = require('../mock-server');

/** Schneidet den Bereich eines Fensters aus dem Bildschirm aus (inkl. mpv-Kindfenster und Overlay). */
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
  return spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
}

/** Anteil heller, farbiger Bildpunkte in der Mitte-links der Aufnahme (Testbild = bunt, schwarzes Fenster = 0). */
function brightShare(file) {
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$b = [System.Drawing.Bitmap]::FromFile('${file.replace(/'/g, "''")}')`,
    '$n = 0; $hit = 0',
    'for ($i = 0; $i -lt 10; $i++) { for ($j = 0; $j -lt 8; $j++) {',
    '  $x = [int]($b.Width * (0.08 + 0.36 * $i / 9)); $y = [int]($b.Height * (0.22 + 0.45 * $j / 7))',
    '  $c = $b.GetPixel($x, $y); $n++; if ([Math]::Max($c.R, [Math]::Max($c.G, $c.B)) -gt 140) { $hit++ } } }',
    '$b.Dispose(); [Math]::Round($hit / $n, 2)'
  ].join('\n');
  return Number(spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).stdout.trim().replace(',', '.'));
}

/** Klassenname des obersten Kindfensters des Hosts (muss "mpv" sein, sonst verdeckt Chromium das Video). */
function topChildClass(hwnd) {
  const ps = `
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class T { [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c); [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string Top(long host) { IntPtr t = GetWindow(new IntPtr(host), 5); if (t == IntPtr.Zero) return "-"; var s = new StringBuilder(64); GetClassName(t, s, 64); return s.ToString(); } }
'@
[T]::Top(${hwnd})`;
  return spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).stdout.trim();
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
  const detect = player.detectMpv();
  check('Echtes mpv gefunden', detect.ok && /vendor|resources/.test(detect.exe), `${detect.exe} ${detect.versionText}`);
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const ov = () => player.overlay;
  const ev = (js) => ov().webContents.executeJavaScript(js);
  const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const waitFor = async (fn, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(150);
    }
    return false;
  };

  state.log.length = 0;
  ctx.config.updateSettings({ player: { volume: 10, muted: false } }); // Testton leise halten
  let playError = null;
  try {
    // Externer Untertitel (Index 6) vorwaehlen, von vorn beginnen
    await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: 0, subtitleIndex: 6 })`);
  } catch (e) {
    playError = e.message;
  }
  check('Wiedergabe startet ohne Fehler', !playError, playError ?? '');
  const playing = await waitFor(() => player.state.phase === 'playing');
  check('Phase "playing" erreicht (echter mpv, eingebettet per --wid)', playing, `phase=${player.state.phase} ${player.state.error ?? ''}`);
  if (!playing) {
    console.log('mpv stderr:', player.mpv?.stderrTail);
    server.close();
    process.exitCode = 1;
    return;
  }

  const { BrowserWindow } = require('electron');
  check('Wiedergabe im selben Fenster (kein zusaetzliches Fenster)', player.host === ctx.win && player.ownsHost === false && BrowserWindow.getAllWindows().length === 2, `Fenster=${BrowserWindow.getAllWindows().length}`);
  player.host.setAlwaysOnTop(true);
  player.host.moveTop();
  await ctx.wait(2500);

  const hostHwnd = player.host.getNativeWindowHandle().readBigUInt64LE(0).toString();
  check('mpv-Fenster liegt zuoberst unter den Kindfenstern des Hosts', topChildClass(hostHwnd) === 'mpv', topChildClass(hostHwnd));
  await key('s');
  await key('Escape'); // Panel kurz oeffnen/schliessen, damit nichts mehr offen ist
  await ctx.wait(500);
  player.overlay.hide(); // freie Sicht aufs Video fuer die Pixelmessung
  await ctx.wait(500);
  grab(path.join(out, 'R-00-real-video-clean.png'), player.host);
  const share0 = brightShare(path.join(out, 'R-00-real-video-clean.png'));
  player.overlay.showInactive();
  check('Video ist auf dem Bildschirm sichtbar (Pixelmessung, nicht schwarz)', share0 >= 0.5, `${Math.round(share0 * 100)} % helle Bildpunkte`);

  const p1 = player.state.position;
  await ctx.wait(2000);
  const p2 = player.state.position;
  check('Video laeuft (Position steigt)', p2 > p1 + 1, `${p1?.toFixed(1)} -> ${p2?.toFixed(1)} s`);
  check('Dauer des echten Videos', Math.abs(player.state.duration - 60) < 1.5, `${player.state.duration?.toFixed?.(1)} s`);
  // Statistik-Werte beobachtet der Player nur, solange die Technik-Info offen ist (spart Arbeit bei jedem Bild)
  await ev(`window.player.send({ type: 'stats', on: true })`);
  await ctx.wait(800);
  const st = player.state.stats ?? {};
  await ev(`window.player.send({ type: 'stats', on: false })`);
  check('Renderer gpu-next', st['current-vo'] === 'gpu-next', st['current-vo']);
  check('Hardware-Dekodierung aktiv', !!st['hwdec-current'] && st['hwdec-current'] !== 'no', st['hwdec-current']);
  check('Video-Parameter 1280x720', player.state.video?.w === 1280 && player.state.video?.h === 720, JSON.stringify(player.state.video));
  check('Audiospur erkannt', (player.state.tracks?.audio?.length ?? 0) === 1);
  const subs = player.state.tracks?.sub ?? [];
  check('Externer Untertitel geladen und gewaehlt', subs.some((s) => s.external && s.selected), JSON.stringify(subs.map((s) => [s.label, s.selected])));

  const sLog = state.log.filter((l) => l.at === 'stream');
  check('Server erhielt Stream-Anfragen mit Token-Header (kein Token in der URL)', sLog.length > 0 && sLog.every((l) => l.hasAuthHeader && !/token|api_key/i.test(l.query)), `${sLog.length} Anfragen`);
  check('Direct Play mit Range-Anfragen (static=true)', sLog.some((l) => l.range) && sLog.every((l) => /static=true/.test(l.query)), sLog.map((l) => l.range).filter(Boolean).slice(0, 2).join(' | '));
  check('Untertitel-Datei mit Token-Header geladen', state.log.some((l) => l.at === 'subtitle' && l.hasAuthHeader));

  // Aufnahme des echten Fensters: mpv-Video + Overlay
  await key('s');
  await ctx.wait(900);
  const g1 = grab(path.join(out, 'R-01-real-video-panel.png'), player.host);
  check('Bildschirmaufnahme (Video + Overlay + Panel)', fs.existsSync(path.join(out, 'R-01-real-video-panel.png')), g1.stderr?.trim()?.slice(0, 120));
  await key('Escape');
  await key('i');
  await ctx.wait(900);
  grab(path.join(out, 'R-02-real-video-info.png'), player.host);
  await key('i');

  // Bedienung mit echtem mpv
  await key(' ');
  await ctx.wait(600);
  check('Pause (echtes mpv)', player.state.paused === true && (await player.mpv.getProperty('pause')) === true);
  const frozen = await player.mpv.getProperty('time-pos');
  await ctx.wait(700);
  check('Bild steht bei Pause', Math.abs((await player.mpv.getProperty('time-pos')) - frozen) < 0.1);
  await key(' ');
  await ev(`window.player.send({ type: 'seek', to: 40 })`);
  await ctx.wait(900);
  check('Seek auf 40 s', (await player.mpv.getProperty('time-pos')) >= 39.5, `${(await player.mpv.getProperty('time-pos')).toFixed(1)} s`);
  await key(']');
  await ctx.wait(400);
  check('Tempo 1,25x', (await player.mpv.getProperty('speed')) === 1.25);
  await key('[');
  await key('ArrowUp');
  await ctx.wait(400);
  check('Lautstaerke steigt um 5 (10 -> 15 %)', Math.round(await player.mpv.getProperty('volume')) === 15);
  check('Untertitel sitzen ueber der Steuerleiste (sub-pos 80)', (await player.mpv.getProperty('sub-pos')) === 80, `sub-pos=${await player.mpv.getProperty('sub-pos')}`);
  // Panel-Wechsel der Untertitel ueber das Overlay
  await ev(`window.player.send({ type: 'sub', id: null })`);
  await ctx.wait(500);
  check('Untertitel abschaltbar', (await player.mpv.getProperty('sid')) === false || (await player.mpv.getProperty('sid')) === 'no');
  await ev(`window.player.send({ type: 'aspect', mode: '4:3' })`);
  await ctx.wait(400);
  check('Bildformat 4:3', Math.abs((await player.mpv.getProperty('video-aspect-override')) - 4 / 3) < 0.01);

  // Groessenaenderung: mpv bleibt oben und sichtbar
  player.host.setContentSize(1000, 660);
  await ctx.wait(1500);
  check('Nach Groessenaenderung liegt mpv weiter zuoberst', topChildClass(hostHwnd) === 'mpv', topChildClass(hostHwnd));
  player.overlay.hide();
  await ctx.wait(500);
  grab(path.join(out, 'R-02b-real-resized.png'), player.host);
  const share1 = brightShare(path.join(out, 'R-02b-real-resized.png'));
  player.overlay.showInactive();
  check('Video nach Groessenaenderung sichtbar', share1 >= 0.5, `${Math.round(share1 * 100)} %`);

  // Das Testvideo ist nur 60 s lang: vor den Aufnahmen im Vollbild zurueckspringen, damit es nicht vor dem Schliessen endet
  await ev(`window.player.send({ type: 'seek', to: 12 })`);
  await ctx.wait(600);

  // Vollbild: Overlay folgt, mpv-Kindfenster fuellt die Flaeche
  await ev(`window.player.send({ type: 'fullscreen' })`);
  await ctx.wait(1500);
  check('Vollbild aktiv', player.host.isFullScreen());
  check('Im Vollbild liegt mpv zuoberst', topChildClass(hostHwnd) === 'mpv', topChildClass(hostHwnd));
  const ob = ov().getBounds();
  const hb = player.host.getContentBounds();
  check('Overlay deckt Vollbild ab', Math.abs(ob.width - hb.width) <= 2 && Math.abs(ob.height - hb.height) <= 2, `${ob.width}x${ob.height} vs ${hb.width}x${hb.height}`);
  const osd = await player.mpv.getProperty('osd-dimensions/w').catch(() => null);
  check('mpv rendert in voller Groesse', osd === null || osd >= hb.width * 0.9, `osd-w=${osd}`);
  grab(path.join(out, 'R-03-real-fullscreen.png'), player.host);
  player.overlay.hide();
  await ctx.wait(500);
  grab(path.join(out, 'R-03b-real-fullscreen-clean.png'), player.host);
  const share2 = brightShare(path.join(out, 'R-03b-real-fullscreen-clean.png'));
  player.overlay.showInactive();
  check('Video im Vollbild sichtbar', share2 >= 0.5, `${Math.round(share2 * 100)} %`);
  await ev(`window.player.send({ type: 'fullscreen', value: false })`);
  await ctx.wait(1200);

  ctx.win.setAlwaysOnTop(false);
  await ev(`window.player.send({ type: 'close' })`);
  check('Schliessen beendet mpv und Overlay, Hauptfenster bleibt', await waitFor(() => !player.mpv && !player.host) && ctx.win.isVisible() && BrowserWindow.getAllWindows().length === 1);
  await ctx.wait(500);
  const names = state.log.map((l) => l.at);
  check('Fortschritt an den Server gemeldet', ['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped'].every((n) => names.includes(n)));
  const stopped = state.log.find((l) => l.at === '/Sessions/Playing/Stopped');
  // Zuletzt auf 12 s gesprungen, danach liefen die Vollbild-Aufnahmen noch einige Sekunden weiter.
  check('Stopped-Position stimmt (12 s + Restlaufzeit der Tests)', stopped?.PositionTicks > 11 * 1e7 && stopped?.PositionTicks < 45 * 1e7, `${(stopped?.PositionTicks / 1e7).toFixed(1)} s`);

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
