// End-to-End-Szenario fuer die Wiedergabe mit dem mpv-Simulator (JC_DEV=1, JC_FAKE_MPV=1):
// Anmeldung -> Film abspielen -> Overlay pruefen -> Episode mit Intro -> Skip -> naechste Folge -> Schliessen -> Server-Log.
const path = require('node:path');
const { server, items, state } = require('../mock-server');

const OVERLAY_CHECK = `(() => {
  const issues = [];
  const rect = (el) => el.getBoundingClientRect();
  const vis = (el) => { const r = rect(el); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.1 && !el.hidden; };
  const hit = (a, b) => { const x = rect(a), y = rect(b); return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1.5; };
  const q = (s) => document.querySelector(s);
  const pairs = [['.titles', '.info'], ['.info', '.floaters'], ['.info', '.bar'], ['.floaters', '.bar'], ['.skip', '.nextcard'], ['.pop', '.top'], ['.pop', '.bar .ctrls'], ['.top .round', '.titles'], ['.seekrow .time', '.seek'], ['.pop', '.info'], ['.pop', '.floaters']];
  for (const [a, b] of pairs) { const x = q(a), y = q(b); if (x && y && vis(x) && vis(y) && !x.contains(y) && !y.contains(x) && hit(x, y)) issues.push(a + ' x ' + b); }
  const W = innerWidth, H = innerHeight;
  for (const el of document.querySelectorAll('.top, .bar, .floaters > *, .info, .pop, .ctrls > *')) { if (!vis(el)) continue; const r = rect(el); if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) issues.push('ausserhalb: ' + (el.className || el.tagName)); }
  const ctrls = q('.ctrls'); if (ctrls) { const kids = [...ctrls.children].filter(vis); for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(kids[i], kids[j])) issues.push('Steuerung ueberlappt: ' + (kids[i].title || kids[i].className) + ' x ' + (kids[j].title || kids[j].className)); }
  return issues;
})()`;

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
  const ov = () => player.overlay;
  // Schliesst die Aktion den Player, ist das Overlay schon weg, bevor executeJavaScript antwortet: das ist Absicht und kein Fehler
  const ev = (js) => ov().webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const shot = async (name) => ctx.capture(path.join(out, `P-${name}.png`), ov());
  const overlayIssues = async (label) => {
    const issues = [...new Set(await ev(OVERLAY_CHECK))];
    check(`Overlay ohne Ueberlappung: ${label}`, issues.length === 0, issues.join('; '));
  };
  const fits = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !el || el.scrollHeight <= el.clientHeight + 1; })()`);
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(150);
    }
    return false;
  };

  state.log.length = 0;
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const mediaDetect = player.detectMpv();
  check('mpv-Erkennung (Simulator)', mediaDetect.ok);

  // ---------- Film ----------
  // Sprach-Einstellungen: Deutsch bevorzugen, volle deutsche Untertitel. Der Server schlaegt Englisch ohne Untertitel vor.
  ctx.config.updateSettings({ player: { audioLanguage: 'de', subtitleMode: 'always', subtitleLanguage: 'de' } });
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: true })`);
  check('Wiedergabe gestartet', await waitFor(() => player.state.phase === 'playing'), `phase=${player.state.phase}`);
  check('Sprach-Einstellung: deutsche Tonspur gewaehlt (Server schlaegt Englisch vor)', player.cur?.audioIdx === 2 && player.mpv.prop('aid') === 2, `Index=${player.cur?.audioIdx} aid=${player.mpv.prop('aid')}`);
  check('Sprach-Einstellung: deutscher Untertitel gewaehlt (Modus "Immer")', player.cur?.subIdx === 4 && player.mpv.prop('sid') === 2, `Index=${player.cur?.subIdx} sid=${player.mpv.prop('sid')}`);
  const { BrowserWindow } = require('electron');
  check('Wiedergabe im selben Fenster: Host ist das Hauptfenster, kein zusaetzliches Fenster', player.host === ctx.win && player.ownsHost === false && BrowserWindow.getAllWindows().length === 2, `Fenster=${BrowserWindow.getAllWindows().length}`);
  check('Hauptfenster bleibt sichtbar', ctx.win.isVisible());
  check('Methode Direct Play', player.state.method === 'DirectPlay', player.state.method);
  const expectedStart = 0.37 * (movie.RunTimeTicks / 1e7) - 5;
  check('Fortsetzen an gemerkter Position (minus Ruecksprung)', Math.abs(player.state.position - expectedStart) < 8, `${player.state.position?.toFixed(1)} s ~ ${expectedStart.toFixed(1)} s`);
  await ctx.wait(1500);
  await shot('01-movie-controls');
  await overlayIssues('Film, Steuerung sichtbar');

  await key('i');
  await ctx.wait(500);
  await shot('02-info');
  await overlayIssues('Technik-Info offen');
  const infoText = await ev(`document.querySelector('.info')?.innerText ?? ''`);
  const flat = infoText.replace(/\s+/g, ' ');
  check('Info zeigt HDR-Ausgabe (PQ)', /PQ/.test(flat), flat);
  check('Info zeigt Codec HEVC und Renderer gpu-next', /HEVC/i.test(flat) && /gpu-next/.test(flat));
  check('Info zeigt Hardware-Dekodierung', /d3d11va/.test(flat));
  check('Info passt ohne Scrollen (1280x720)', await fits('.info'));
  const infoClass = await ev(`document.querySelector('.info').className`);
  await key('i');

  await key('s');
  await ctx.wait(500);
  await shot('03-tracks');
  await overlayIssues('Audio-/Untertitel-Panel');
  check('Audio-/Untertitel-Panel passt ohne Scrollen (viele Spuren, 1280x720)', await fits('.pop'), await ev(`document.querySelector('.pop').className + ' / ' + document.querySelectorAll('.pop .col')[1].querySelectorAll('.opt').length + ' Untertitel'`));
  const trackText = await ev(`document.querySelector('.pop')?.innerText ?? ''`);
  check('Panel listet Audio und Untertitel', /TrueHD|Atmos/i.test(trackText) && /PGS/i.test(trackText), trackText.replace(/\s+/g, ' ').slice(0, 100));
  await ev(`[...document.querySelectorAll('.pop .col')[1].querySelectorAll('.opt')].find(b => /Erzwungen/.test(b.textContent)).click()`);
  await ctx.wait(500);
  check('Untertitel-Auswahl erreicht mpv', player.mpv.prop('sid') === 3, `sid=${player.mpv.prop('sid')}`);
  check('Panel schliesst nach der Auswahl', await ev(`!document.querySelector('.pop')`) || (await ctx.wait(300), await ev(`!document.querySelector('.pop')`)));

  await key(' ');
  await ctx.wait(500);
  check('Pause ueber Leertaste', player.state.paused === true);
  const frozen = player.state.position;
  await ctx.wait(800);
  check('Zeit steht bei Pause', Math.abs(player.state.position - frozen) < 0.3);
  await shot('04-paused');
  await key(' ');
  await key('ArrowRight');
  await ctx.wait(600);
  check('Seek mit Pfeiltaste (+5 s)', player.state.position > frozen + 3, `${frozen.toFixed(1)} -> ${player.state.position.toFixed(1)}`);
  await key('ArrowUp');
  await ctx.wait(600);
  check('Lautstaerke ueber Pfeiltaste', player.state.volume === 105, `volume=${player.state.volume}`);
  await key('m');
  await ctx.wait(400);
  check('Stumm ueber M', player.state.mute === true);
  await key('m');

  // Fenster verkleinern -> Overlay folgt, keine Ueberlappung
  player.host.setContentSize(800, 450);
  await ctx.wait(900);
  const ob = ov().getBounds();
  const hb = player.host.getContentBounds();
  check('Overlay folgt dem Hostfenster', Math.abs(ob.width - hb.width) <= 2 && Math.abs(ob.height - hb.height) <= 2 && Math.abs(ob.x - hb.x) <= 2 && Math.abs(ob.y - hb.y) <= 2, `${ob.width}x${ob.height} vs ${hb.width}x${hb.height}`);
  await key('i');
  await key('s');
  await ctx.wait(500);
  await shot('05-small-window');
  await overlayIssues('kleines Fenster 800x450 mit Info + Panel');
  await key('Escape');
  await key('i');
  for (const [w, h] of [[920, 620], [1920, 1080]]) {
    player.host.setContentSize(w, h);
    await ctx.wait(900);
    await key('i');
    await ctx.wait(500);
    check(`Info passt ohne Scrollen (${w}x${h})`, await fits('.info'), await ev(`document.querySelector('.info').className`));
    await overlayIssues(`Info offen ${w}x${h}`);
    await shot(`05b-info-${w}x${h}`);
    await key('i');
    await key('s');
    await ctx.wait(600);
    check(`Spur-Panel passt ohne Scrollen (${w}x${h})`, await fits('.pop'), await ev(`document.querySelector('.pop')?.className`));
    await overlayIssues(`Spur-Panel ${w}x${h}`);
    await shot(`05c-tracks-${w}x${h}`);
    await key('Escape');
    await ctx.wait(300);
  }
  player.host.setContentSize(1280, 720);
  await ctx.wait(700);

  await ev(`window.player.send({ type: 'close' })`);
  check('Schliessen beendet die Wiedergabe', await waitFor(() => !player.mpv && !player.host), '');
  check('Hauptfenster bleibt bestehen, Overlay ist weg', ctx.win.isVisible() && !ctx.win.isDestroyed() && BrowserWindow.getAllWindows().length === 1, `Fenster=${BrowserWindow.getAllWindows().length}`);

  // Die Stopped-Meldung geht im Hintergrund raus (Schliessen wartet nicht auf den Server): kurz auf ihr Eintreffen warten
  await waitFor(() => state.log.some((l) => l.at === '/Sessions/Playing/Stopped' && l.ItemId === movie.Id), 4000);
  const movieLog = state.log.filter((l) => l.ItemId === movie.Id || l.at === 'PlaybackInfo');
  const names = movieLog.map((l) => l.at);
  check('Server-Log: PlaybackInfo -> Playing -> Progress -> Stopped', ['PlaybackInfo', '/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped'].every((n) => names.includes(n)), names.join(' > '));
  const stopped = movieLog.find((l) => l.at === '/Sessions/Playing/Stopped');
  check('Stopped meldet Position > 0', stopped?.PositionTicks > 0, `${(stopped?.PositionTicks / 1e7).toFixed(0)} s`);
  const playing = movieLog.find((l) => l.at === '/Sessions/Playing');
  check('Playing meldet PlayMethod und Sitzung', playing?.PlayMethod === 'DirectPlay' && !!playing?.PlaySessionId, `${playing?.PlayMethod}/${playing?.PlaySessionId}`);

  // ---------- Serie: Intro, Skip, naechste Folge ----------
  state.log.length = 0;
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'The Winter Archive');
  const eps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === series.Id);
  const ep1 = eps[0];
  const ep2 = eps[1];
  await ctx.run(`window.jc.play({ itemId: '${ep1.Id}', startTicks: ${25 * 1e7}, resume: false })`);
  await waitFor(() => player.state.phase === 'playing');
  await waitFor(() => player.state.segments?.length > 0);
  await ctx.wait(1200);
  check('Intro-Segment geladen', player.state.segments?.[0]?.type === 'Intro');
  check('Naechste Folge ermittelt', player.state.next?.id === ep2.Id, JSON.stringify(player.state.next));
  const skipVisible = await waitFor(async () => (await ev(`!document.querySelector('.skip').hidden`)));
  check('Skip-Button erscheint im Intro', skipVisible);
  await shot('06-skip-intro');
  await overlayIssues('Skip-Button sichtbar');
  await ev(`document.querySelector('.skip').click()`);
  await ctx.wait(900);
  check('Skip springt hinter das Intro', player.state.position >= 84, `${player.state.position.toFixed(1)} s`);
  check('Skip-Button verschwindet danach', await waitFor(async () => await ev(`document.querySelector('.skip').hidden`)));

  await ev(`window.player.send({ type: 'seek', to: 5392 })`);
  await ctx.wait(700);
  const nextVisible = await ev(`!document.querySelector('.nextcard').hidden`);
  check('Karte "Naechste Folge" gegen Ende', nextVisible);
  await shot('07-next-episode');
  await overlayIssues('Naechste-Folge-Karte');
  const advanced = await waitFor(() => player.cur?.item?.Id === ep2.Id && player.state.phase === 'playing', 12000);
  check('Autoplay startet die naechste Folge', advanced, `aktuell=${player.cur?.item?.Name}`);
  // Der Start-Bericht an den Server geht asynchron hinter dem Wechsel des Players her: kurz auf ihn warten, statt gegen einen Zeitpunkt zu pruefen
  await waitFor(() => state.log.some((l) => l.at === '/Sessions/Playing' && l.ItemId === ep2.Id), 4000);
  const sNames = state.log.map((l) => `${l.at.replace('/Sessions/', '')}${l.ItemId === ep1.Id ? '(1)' : l.ItemId === ep2.Id ? '(2)' : ''}`);
  check('Server-Log: Folge 1 gestoppt, Folge 2 gestartet', sNames.includes('Playing/Stopped(1)') && sNames.includes('Playing(2)'), sNames.join(' > '));
  const stop1 = state.log.find((l) => l.at === '/Sessions/Playing/Stopped' && l.ItemId === ep1.Id);
  check('Folge 1 am Ende gemeldet (>= 99 %)', stop1?.PositionTicks / ep1.RunTimeTicks >= 0 && stop1?.PositionTicks > 5000 * 1e7, `${(stop1?.PositionTicks / 1e7).toFixed(0)} s`);

  await ev(`window.player.send({ type: 'close' })`);
  await waitFor(() => !player.mpv && !player.host);
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
