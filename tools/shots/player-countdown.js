// Ueberspringen und "Naechste Folge" wie in der Apple-App (Plan P22, E10 "Wie Apple, ueberall"), mit dem mpv-Simulator (JC_DEV=1, JC_FAKE_MPV=1).
// Folgen des Testservers: Rueckblick 0-12 s, Intro 20-85 s, Abspann 5340-5400 s (bis ans Ende); der Simulator spielt 5400 s.
// Geprueft: ueber dem Bild nur "Intro ueberspringen" (Knopf zeigen: nur Klick; Automatisch: der Knopf fuellt sich nach Spielzeit, Pause haelt ihn an,
// einmal je Abschnitt), Rueckblick automatisch mit Meldung und ohne Knopf, Countdown "Naechste Folge" schon im Abspann (10 s, das Bild laeuft klein
// weiter: Raender von mpv und die Aussparung der Flaeche passen zusammen), Ausblenden (am Ende kommt er wieder, 5 s), Anhalten blendet ihn aus,
// "Schliessen" am Ende schliesst den Player, ohne "Naechste Folge automatisch" schliesst er am Ende, Escape, reduzierte Bewegung.
const path = require('node:path');
const { server, items } = require('../mock-server');

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
  const errors = [];
  const ev = (js) => player.overlay.webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(60);
    }
    return false;
  };
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'The Winter Archive');
  const eps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === series.Id);
  const [ep1, ep2] = eps;
  const q = (sel, prop) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? ${prop} : null; })()`);
  const skipShown = () => q('.skip', '!e.hidden');
  const counting = (sel) => q(sel, `e.classList.contains('counting')`);
  const fill = async (sel) => {
    const t = await q(`${sel} .cd > i`, 'e.style.transform');
    const m = /scaleX\(([\d.]+)\)/.exec(t ?? '');
    return m ? +m[1] : null;
  };
  const flashText = () => ev(`(() => { const f = document.querySelector('.flash'); return f?.classList.contains('show') ? f.textContent : ''; })()`);
  const upnextShown = () => q('.upnext', '!e.hidden');
  const margins = async () => Promise.all(['left', 'right', 'top', 'bottom'].map((s) => player.mpv?.getProperty(`video-margin-ratio-${s}`).catch(() => null)));
  const play = async (startSec, item = ep1) => {
    await ctx.run(`window.jc.play({ itemId: '${item.Id}', startTicks: ${Math.round(startSec * 1e7)}, resume: false })`);
    const ok = await waitFor(() => player.state.phase === 'playing');
    if (ok) player.overlay.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && errors.push(`[${e.level}] ${e.message}`));
    await waitFor(() => player.cur?.segments?.length > 0);
    return ok;
  };
  const stop = async () => {
    if (player.overlay) await ev(`window.player.send({ type: 'close' })`);
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(500);
  };
  const cfg = (p) => ctx.config.updateSettings({ player: p });

  const p0 = ctx.config.settings.player;
  check('Standard wie die Apple-App: Intro und Abspann "Knopf zeigen", Rueckblick und Vorschau aus, Wartezeit 5 s', p0.skipIntro === 'button' && p0.skipOutro === 'button' && p0.skipRecap === 'off' && p0.skipPreview === 'off' && p0.skipDelay === 5 && p0.autoplayNext === true, JSON.stringify([p0.skipIntro, p0.skipOutro, p0.skipRecap, p0.skipPreview, p0.skipDelay]));

  // ---------- 1) Intro, "Knopf zeigen": nur Klick ----------
  check('Wiedergabe von Folge 1 (im Intro, ab 25 s)', await play(25));
  check('"Intro ueberspringen" erscheint und fuellt sich nicht', (await waitFor(skipShown)) && (await counting('.skip')) === false && /Intro überspringen/.test(await q('.skip', 'e.textContent')));
  await ctx.capture(path.join(out, 'CD-01-intro-knopf.png'), player.overlay);
  await ctx.wait(1500);
  check('Ohne "Automatisch" springt nichts von selbst', player.state.position < 40 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  await ev(`document.querySelector('.skip').click()`);
  check('Klick springt hinter das Intro, der Knopf verschwindet', (await waitFor(() => player.state.position >= 84, 2500)) && (await waitFor(async () => (await skipShown()) === false)), `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 2) Intro "Automatisch" mit 3 s: Fuellung, Sprung, Meldung, einmal je Abschnitt ----------
  cfg({ skipIntro: 'auto', skipDelay: 3 });
  check('Wiedergabe mit Intro "Automatisch", 3 s', await play(25));
  const tStart = Date.now();
  check('Der Knopf fuellt sich (Klasse "counting")', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ctx.wait(1200);
  const f3 = await fill('.skip');
  check('Nach rund 1,2 s ist gut ein Drittel gefuellt', f3 > 0.15 && f3 < 0.7, String(f3));
  await ctx.capture(path.join(out, 'CD-02-intro-fuellt-sich.png'), player.overlay);
  const skipped = await waitFor(() => player.state.position >= 84, 7000);
  const took = (Date.now() - tStart) / 1000;
  check('Nach Ablauf springt der Player von selbst hinter das Intro', skipped && took > 2.2 && took < 6.5, `${took.toFixed(1)} s, Position ${player.state.position?.toFixed(1)} s`);
  check('Kurze Meldung "Intro übersprungen"', await waitFor(async () => /Intro übersprungen/.test(await flashText()), 2000), await flashText());
  await ev(`window.player.send({ type: 'seek', to: 40 })`);
  check('Zurueck ins Intro gespult: Knopf da, aber ohne zweiten Timer', (await waitFor(skipShown)) && (await counting('.skip')) === false);
  await ctx.wait(3800);
  check('...und es wird nicht noch einmal automatisch uebersprungen', player.state.position < 60 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 3) Pause haelt die Fuellung an (Spielzeit) ----------
  check('Wiedergabe (Pause-Test)', await play(25));
  check('Knopf fuellt sich (Pause-Test)', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ev(`window.player.send({ type: 'pause' })`);
  await ctx.wait(400);
  const fa = await fill('.skip');
  await ctx.wait(4000);
  const fb = await fill('.skip');
  check('In der Pause bleibt die Fuellung stehen und nichts springt', fb !== null && Math.abs(fb - fa) < 0.03 && player.state.position < 40 && (await skipShown()) === true, `${fa} -> ${fb}, ${player.state.position?.toFixed(1)} s`);
  await ev(`window.player.send({ type: 'pause' })`);
  check('Weiterspielen: die Fuellung laeuft weiter und springt', await waitFor(() => player.state.position >= 84, 6000), `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 4) Rueckblick "Automatisch", "Sofort": Sprung mit Meldung, kein Knopf ----------
  cfg({ skipIntro: 'button', skipRecap: 'auto', skipDelay: 0 });
  check('Wiedergabe im Rueckblick (ab 2 s), Rueckblick "Automatisch", sofort', await play(2));
  check('Der Player springt hinter den Rueckblick', await waitFor(() => player.state.position >= 12, 4000), `${player.state.position?.toFixed(1)} s`);
  check('Meldung "Rückblick übersprungen", kein Knopf fuer den Rueckblick', (await waitFor(async () => /Rückblick übersprungen/.test(await flashText()), 2000)) && player.state.skip?.type !== 'Recap');
  await stop();
  cfg({ skipRecap: 'off', skipDelay: 5 });

  // ---------- 5) Abspann bis ans Ende: Countdown schon im Abspann (10 s), das Bild laeuft klein weiter, danach die naechste Folge ----------
  check('Wiedergabe kurz vor dem Abspann (ab 5339 s, mit dem Ruecksprung 5334 s)', await play(5339));
  check('Vor dem Abspann kein Countdown und kein Knopf "Abspann ueberspringen"', (await upnextShown()) === false && (await skipShown()) === false);
  check('Mit dem Abspann erscheint "Naechste Folge"', await waitFor(upnextShown, 10000));
  const inCredits = await q('.upnext', `e.classList.contains('in-credits')`);
  const hole = await q('.upnext-hole', `({ hidden: e.hidden, x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight })`);
  const m = await margins();
  const b = player.host.getContentBounds();
  const holeFits = hole && !hole.hidden && Math.abs(hole.x - m[0] * b.width) < 2 && Math.abs(hole.w - (1 - m[0] - m[1]) * b.width) < 2 && Math.abs(hole.y - m[2] * b.height) < 2 && Math.abs(hole.h - (1 - m[2] - m[3]) * b.height) < 2;
  check('Im Abspann: das Bild laeuft klein weiter (Raender von mpv), die Aussparung der Flaeche liegt genau darauf', inCredits === true && m[0] > 0.02 && m[1] > 0.3 && holeFits, JSON.stringify({ m: m.map((x) => x?.toFixed?.(3)), hole, b: [b.width, b.height] }));
  check('Bildschirm nennt die naechste Folge, "Abspielen" fuellt sich, "Ausblenden" statt "Schliessen"', /Episode 2/.test(await q('.upnext-title', 'e.textContent')) && /Abspielen/.test(await q('.upnext-play', 'e.textContent')) && /Ausblenden/.test(await q('.upnext-hide', 'e.textContent')));
  await ctx.wait(1500);
  const fu = await fill('.upnext-play');
  check('Nach rund 1,5 s von 10 s ist "Abspielen" etwas gefuellt', fu > 0.05 && fu < 0.4, String(fu));
  check('Bedienung und "Intro ueberspringen" sind waehrenddessen ausgeblendet', (await ev(`getComputedStyle(document.querySelector('.bar')).opacity`)) === '0');
  await ctx.capture(path.join(out, 'CD-03-naechste-folge-im-abspann.png'), player.overlay);
  const tNext = Date.now();
  const advanced = await waitFor(() => player.cur?.item?.Id === ep2.Id && player.state.phase === 'playing', 14000);
  check('Nach 10 s startet die naechste Folge, vor dem Ende der alten', advanced && (Date.now() - tNext) / 1000 < 11, `${((Date.now() - tNext) / 1000).toFixed(1)} s, ${player.cur?.item?.Name}`);
  check('...das Bild ist wieder ganz (Raender 0), der Bildschirm weg', (await waitFor(async () => (await margins()).every((x) => x === 0))) && (await upnextShown()) === false, JSON.stringify(await margins()));
  await stop();

  // ---------- 6) "Ausblenden": der Abspann laeuft weiter, am Ende kommt der Countdown wieder (5 s, "Schliessen") ----------
  check('Wiedergabe kurz vor dem Abspann (ab 5344 s, mit dem Ruecksprung 5339 s)', await play(5344));
  check('Countdown im Abspann', await waitFor(upnextShown, 6000));
  await ev(`document.querySelector('.upnext-hide').click()`);
  check('"Ausblenden": der Bildschirm ist weg, das Bild wieder ganz, die Folge laeuft weiter', (await waitFor(async () => (await upnextShown()) === false)) && (await waitFor(async () => (await margins()).every((x) => x === 0))) && player.cur?.item?.Id === ep1.Id);
  await ev(`window.player.send({ type: 'seek', to: 5394 })`);
  check('Am Ende kommt der Countdown wieder, ohne kleines Bild, mit "Schliessen"', (await waitFor(upnextShown, 9000)) && (await q('.upnext', `e.classList.contains('in-credits')`)) === false && /Schließen/.test(await q('.upnext-hide', 'e.textContent')));
  await ctx.wait(700); // Einblenden abwarten (sonst zeigt die Aufnahme das noch durchsichtige Fenster)
  const thumb = await q('.upnext-thumb', `({ hidden: e.hidden, loaded: e.complete && e.naturalWidth > 0 })`);
  check('Am Ende steht das Bild der naechsten Folge an der Stelle des kleinen Videos', thumb?.hidden === false && thumb.loaded === true, JSON.stringify(thumb));
  await ctx.capture(path.join(out, 'CD-04-naechste-folge-am-ende.png'), player.overlay);
  check('Nach 5 s startet die naechste Folge', await waitFor(() => player.cur?.item?.Id === ep2.Id && player.state.phase === 'playing', 9000));
  await stop();

  // ---------- 7) Anhalten im Abspann blendet den Countdown aus; Escape am Ende schliesst den Player ----------
  check('Wiedergabe kurz vor dem Abspann (Pause-Test)', await play(5344));
  check('Countdown im Abspann (Pause-Test)', await waitFor(upnextShown, 6000));
  await ev(`window.player.send({ type: 'pause' })`);
  check('Anhalten: der Countdown verschwindet', await waitFor(async () => (await upnextShown()) === false, 3000));
  await ctx.wait(1200);
  check('...und kommt in der Pause nicht wieder', (await upnextShown()) === false && player.cur?.item?.Id === ep1.Id);
  await ev(`window.player.send({ type: 'pause' })`);
  await ev(`window.player.send({ type: 'seek', to: 5394 })`);
  check('Am Ende ist er wieder da', await waitFor(upnextShown, 9000));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Escape am Ende ("Schliessen"): der Player schliesst', await waitFor(() => !player.mpv && !player.overlay, 6000));
  await ctx.wait(500);

  // ---------- 8) Ohne "Naechste Folge automatisch": kein Countdown, am Ende schliesst der Player ----------
  cfg({ autoplayNext: false });
  check('Wiedergabe im Abspann (Autoplay aus)', await play(5395));
  await ctx.wait(2500);
  check('Kein Countdown im Abspann', (await upnextShown()) === false);
  check('Am Ende schliesst der Player', await waitFor(() => !player.mpv && !player.overlay, 15000));
  await ctx.wait(500);
  cfg({ autoplayNext: true });

  // ---------- 9) System "Bewegung reduzieren": die Fuellung laeuft gleich lang (kein CSS-Ablauf) ----------
  cfg({ skipIntro: 'auto', skipDelay: 3 });
  check('Wiedergabe mit "Bewegung reduzieren"', await play(25));
  await ctx.reducedMotion(true, player.overlay.webContents);
  check('Das Overlay folgt der Systemeinstellung (data-anim reduced)', await waitFor(async () => (await ev(`document.documentElement.dataset.anim`)) === 'reduced', 2000));
  const tOff = Date.now();
  check('Knopf fuellt sich auch mit reduzierter Bewegung', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ctx.wait(700);
  check('Reduziert: nach 0,7 s noch nicht gesprungen', player.state.position < 40 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  check('...und nach rund 3 s springt es', (await waitFor(() => player.state.position >= 84, 6500)) && (Date.now() - tOff) / 1000 > 2.2, `${((Date.now() - tOff) / 1000).toFixed(1)} s`);
  await stop();
  cfg({ skipIntro: 'button', skipDelay: 5 });

  check('Keine Konsolenfehler im Player', errors.length === 0, errors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
