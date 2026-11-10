// Countdown an "Intro ueberspringen" und "Naechste Folge" (wie bei Netflix), mit dem mpv-Simulator (JC_DEV=1, JC_FAKE_MPV=1):
// der Knopf fuellt sich von links nach rechts, ist er voll, geht es von selbst weiter. Pause und Puffern halten ihn an, ein Klick loest es sofort aus,
// ein Eintrag zaehlt nur einmal (zurueckspulen = Knopf ohne zweiten Countdown), 0 = aus, die naechste Folge nur mit automatischem Abspielen, "Animationen aus" zaehlt trotzdem.
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
  const play = async (startSec, item = ep1) => {
    await ctx.run(`window.jc.play({ itemId: '${item.Id}', startTicks: ${Math.round(startSec * 1e7)}, resume: false })`);
    const ok = await waitFor(() => player.state.phase === 'playing');
    if (ok) player.overlay.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && errors.push(`[${e.level}] ${e.message}`));
    await waitFor(() => player.state.segments?.length > 0);
    return ok;
  };
  const stop = async () => {
    await ev(`window.player.send({ type: 'close' })`);
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(500);
  };
  const cfg = (player_, appearance) => ctx.config.updateSettings({ player: player_, ...(appearance ? { appearance } : {}) });

  check('Standard: Countdown 6 Sekunden, naechste Folge mit Autoplay', ctx.config.settings.player.skipCountdown === 6 && ctx.config.settings.player.autoplayNext === true, String(ctx.config.settings.player.skipCountdown));

  // ---------- 1) Standard (6 s): der Knopf fuellt sich im Takt von 6 Sekunden, ein Klick loest sofort aus ----------
  check('Wiedergabe von Folge 1 (im Intro, ab 25 s)', await play(25));
  check('Skip-Knopf erscheint im Intro', await waitFor(skipShown));
  check('...und zaehlt (Klasse "counting")', await waitFor(() => counting('.skip')));
  await ctx.wait(1500);
  const f6 = await fill('.skip');
  check('Standard 6 s: nach rund 1,5 s ist gut ein Viertel gefuellt', f6 > 0.1 && f6 < 0.45, String(f6));
  await ctx.capture(path.join(out, 'CD-01-skip-fuellt-sich.png'), player.overlay);
  const t0 = Date.now();
  await ev(`document.querySelector('.skip').click()`);
  check('Klick loest sofort aus (springt hinter das Intro)', await waitFor(() => player.state.position >= 84, 2500), `${player.state.position?.toFixed(1)} s nach ${Date.now() - t0} ms`);
  check('Danach verschwindet der Knopf', await waitFor(async () => (await skipShown()) === false));
  await stop();

  // ---------- 2) 3 s: von selbst ueberspringen, zurueckspulen gibt keinen zweiten Countdown ----------
  cfg({ skipCountdown: 3 });
  check('Wiedergabe mit 3 s Countdown', await play(25));
  const tStart = Date.now();
  check('Knopf zaehlt', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ctx.wait(1200);
  const f3 = await fill('.skip');
  check('3 s: nach rund 1,2 s ist gut ein Drittel gefuellt', f3 > 0.2 && f3 < 0.65, String(f3));
  const skipped = await waitFor(() => player.state.position >= 84, 7000);
  const took = (Date.now() - tStart) / 1000;
  check('Nach Ablauf springt der Player von selbst hinter das Intro (ohne Klick)', skipped && took > 2.4 && took < 6.5, `${took.toFixed(1)} s, Position ${player.state.position?.toFixed(1)} s`);
  check('Der Knopf ist danach weg und zaehlt nicht mehr', (await waitFor(async () => (await skipShown()) === false)) && (await counting('.skip')) === false);
  await ev(`window.player.send({ type: 'seek', to: 40 })`);
  check('Zurueck ins Intro gespult: Knopf da, aber ohne zweiten Countdown', (await waitFor(skipShown)) && (await counting('.skip')) === false);
  await ctx.wait(3800);
  check('...und es wird nicht noch einmal automatisch uebersprungen', player.state.position < 60 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 3) Pause haelt den Countdown an ----------
  check('Wiedergabe (Pause-Test)', await play(25));
  check('Knopf zaehlt (Pause-Test)', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ev(`window.player.send({ type: 'pause' })`);
  await ctx.wait(400);
  const fa = await fill('.skip');
  await ctx.wait(4000); // laenger als der Countdown (3 s)
  const fb = await fill('.skip');
  check('In der Pause bleibt der Knopf stehen (Fuellstand gleich) und ist nicht ausgeloest', fb !== null && Math.abs(fb - fa) < 0.02 && player.state.position < 40 && (await skipShown()) === true, `${fa} -> ${fb}, ${player.state.position?.toFixed(1)} s`);
  await ev(`window.player.send({ type: 'pause' })`);
  check('Weiterspielen: der Countdown laeuft weiter und loest aus', await waitFor(() => player.state.position >= 84, 6000), `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 4) Aus (0): kein Countdown, nichts geschieht von selbst ----------
  cfg({ skipCountdown: 0 });
  check('Wiedergabe mit Countdown aus', await play(25));
  check('Knopf erscheint', await waitFor(skipShown));
  await ctx.wait(4000);
  check('Aus: kein Countdown, kein Sprung von selbst', (await counting('.skip')) === false && player.state.position < 40 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  await stop();

  // ---------- 5) "Animationen aus": der Countdown zaehlt trotzdem (kein sofortiger Ablauf) ----------
  cfg({ skipCountdown: 3 }, { animations: 'off' });
  check('Wiedergabe mit "Animationen aus"', await play(25));
  const tOff = Date.now();
  check('Knopf zaehlt auch ohne Animationen', await waitFor(async () => (await skipShown()) && (await counting('.skip'))));
  await ctx.wait(700);
  check('Animationen aus: nach 0,7 s noch nicht ausgeloest (der Ablauf ist kein CSS-Uebergang)', player.state.position < 40 && (await skipShown()) === true, `${player.state.position?.toFixed(1)} s`);
  check('...und nach rund 3 s springt es', (await waitFor(() => player.state.position >= 84, 6500)) && (Date.now() - tOff) / 1000 > 2.4, `${((Date.now() - tOff) / 1000).toFixed(1)} s`);
  await stop();
  cfg({}, { animations: 'full' });

  // ---------- 6) Naechste Folge: Karte am Ende, Knopf "Jetzt" zaehlt, danach startet die naechste Folge ----------
  check('Wiedergabe kurz vor dem Ende (5372 s, 28 s Rest)', await play(5372));
  check('Karte "Als Naechstes" ist da', await waitFor(() => q('.nextcard', '!e.hidden')));
  check('Der Knopf "Jetzt" zaehlt', await waitFor(() => counting('.nextcard .go')));
  const tNext = Date.now();
  const advanced = await waitFor(() => player.cur?.item?.Id === ep2.Id && player.state.phase === 'playing', 9000);
  check('Nach dem Countdown startet die naechste Folge, lange vor dem Ende der alten (28 s Rest)', advanced && (Date.now() - tNext) / 1000 < 8, `${((Date.now() - tNext) / 1000).toFixed(1)} s, Folge ${player.cur?.item?.Name}`);
  await stop();

  // ---------- 7) Ohne automatisches Abspielen: die Karte bleibt, aber ohne Countdown ----------
  cfg({ autoplayNext: false });
  check('Wiedergabe kurz vor dem Ende (Autoplay aus)', await play(5372));
  check('Karte ist da', await waitFor(() => q('.nextcard', '!e.hidden')));
  await ctx.wait(4500);
  check('Autoplay aus: kein Countdown, die Folge laeuft weiter', (await counting('.nextcard .go')) === false && player.cur?.item?.Id === ep1.Id, `Folge ${player.cur?.item?.Name}`);
  await ev(`document.querySelector('.nextcard .go').click()`);
  check('Ein Klick auf "Jetzt" startet die naechste Folge trotzdem sofort', await waitFor(() => player.cur?.item?.Id === ep2.Id, 4000));
  await stop();
  cfg({ autoplayNext: true });

  check('Keine Konsolenfehler im Player', errors.length === 0, errors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
