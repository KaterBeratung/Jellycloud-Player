// Folgen und Staffeln im Player (JC_DEV=1, JC_FAKE_MPV=1): Knopf "Folgen" nur bei Serien, Liste mit Staffel-Reitern, laufende Folge hervorgehoben,
// Klick auf eine Folge wechselt im laufenden Player (mit Berichten an den Server), Spoiler-Schutz, Tastatur (E, Escape), Mausrad scrollt die Liste statt die Lautstaerke zu aendern.
const path = require('node:path');
const { server, items, state } = require('../mock-server');

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
      await ctx.wait(80);
    }
    return false;
  };
  const q = (sel, prop) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? ${prop} : null; })()`);
  const qa = (sel, expr) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${expr})`);
  const BTN = `.ctrls .ibtn[title="Folgen"], .ctrls .ibtn[title="Episodes"]`;
  const btnShown = async () => (await q(BTN, '!e.hidden')) === true;
  const popOpen = () => q('.pop.eps', `e.classList.contains('open')`);
  const play = async (item, startSec = 100) => {
    await ctx.run(`window.jc.play({ itemId: '${item.Id}', startTicks: ${Math.round(startSec * 1e7)}, resume: false })`);
    const ok = await waitFor(() => player.state.phase === 'playing');
    if (ok) player.overlay.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && errors.push(`[${e.level}] ${e.message}`));
    await waitFor(() => player.state.episodes !== undefined, 3000);
    await ctx.wait(500);
    return ok;
  };
  const stop = async () => {
    await ev(`window.player.send({ type: 'close' })`);
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(500);
  };

  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Harbor Lights');
  const eps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === series.Id);
  const seasonsN = new Set(eps.map((e) => e.ParentIndexNumber)).size;
  const perSeason = eps.filter((e) => e.ParentIndexNumber === 1).length;
  const ep11 = eps.find((e) => e.ParentIndexNumber === 1 && e.IndexNumber === 1);
  const ep23 = eps.find((e) => e.ParentIndexNumber === 2 && e.IndexNumber === 3);

  // ---------- Film: kein Knopf ----------
  state.log.length = 0;
  check('Film startet', await play(movie, 60));
  check('Film: kein Knopf "Folgen"', (await q(BTN, 'true')) === true && !(await btnShown()));
  await stop();

  // ---------- Serie: Knopf, Liste, Reiter ----------
  check('Serie startet (Harbor Lights, S1E1)', await play(ep11, 100));
  check('Der Knopf "Folgen" ist da', await waitFor(btnShown));
  check('Der Zustand enthaelt alle Folgen der Serie', player.state.episodes?.length === eps.length && player.state.episodes[0]?.id === ep11.Id, `${player.state.episodes?.length} von ${eps.length}`);
  await ev(`document.querySelector('${BTN}').click()`);
  check('Klick auf den Knopf oeffnet die Liste', await waitFor(popOpen));
  const tabs = await qa('.eps-tab', 'e.textContent.trim()');
  check('Reiter: eine Staffel je Eintrag, der erste ist gewaehlt', tabs.length === seasonsN && (await qa('.eps-tab', `e.classList.contains('on')`))[0] === true, tabs.join(' | '));
  const rows = await qa('.ep-row', `({ cur: e.classList.contains('cur'), n: e.querySelector('.ep-n').textContent, t: e.querySelector('.ep-t').textContent, m: e.querySelector('.ep-m').textContent })`);
  check('Staffel 1: alle Folgen der Staffel in der Liste', rows.length === perSeason, `${rows.length} von ${perSeason}`);
  check('Die laufende Folge ist hervorgehoben und als "Laeuft" gekennzeichnet', rows.filter((r) => r.cur).length === 1 && rows[0].cur && /Läuft|Playing/.test(rows[0].m), JSON.stringify(rows[0]));
  check('Die Folgen tragen Nummer, Titel und Laenge', rows.every((r) => r.n && r.t) && rows.slice(1).every((r) => /Min|min|Std|h/.test(r.m)), JSON.stringify(rows[1]));
  const imgs = await qa('.ep-th img', 'e.getAttribute("src")');
  check('Jede Folge hat ein Vorschaubild ueber das jellycloud-Protokoll', imgs.length === perSeason && imgs.every((s) => /^jellycloud:\/\/img\/[0-9a-f]+\/Primary\?/.test(s)), imgs[0] ?? '');
  await ctx.wait(700);
  const geo = await ev(`(() => { const p = document.querySelector('.pop.eps').getBoundingClientRect(); const c = document.querySelector('.bar .ctrls').getBoundingClientRect(); const top = document.querySelector('.top').getBoundingClientRect(); return { l: Math.round(p.left), r: Math.round(p.right), t: Math.round(p.top), b: Math.round(p.bottom), W: innerWidth, ctrlsTop: Math.round(c.top), topBottom: Math.round(top.bottom) }; })()`);
  check('Die Liste liegt ganz im Fenster, ueber den Knoepfen der Steuerleiste und unter der Kopfleiste', geo.l >= 0 && geo.r <= geo.W && geo.t >= geo.topBottom - 1 && geo.b <= geo.ctrlsTop + 1, JSON.stringify(geo));
  await ctx.wait(700); // Einblenden (Deckkraft, Weichzeichner, Groesse) laeuft aus
  const look = await ev(`(() => { const p = document.querySelector('.pop.eps'); const s = getComputedStyle(p); return { opacity: +s.opacity, filter: s.filter, transform: s.transform, bg: s.backgroundColor, vis: s.visibility, display: s.display }; })()`);
  check('Die Liste ist eingeblendet (voll deckend, ohne Weichzeichner, in Endgroesse)', look.opacity === 1 && look.filter === 'none' && look.transform === 'none' && look.vis === 'visible', JSON.stringify(look));
  await ctx.capture(path.join(out, 'EP-01-liste.png'), player.overlay);

  // Mausrad ueber der Liste: sie scrollt, die Lautstaerke bleibt
  const vol0 = player.state.volume;
  await ev(`document.querySelector('.eps-list').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`);
  await ctx.wait(300);
  check('Mausrad ueber der Liste aendert die Lautstaerke nicht', player.state.volume === vol0, `${vol0} -> ${player.state.volume}`);

  // Staffel 2 waehlen
  await ev(`document.querySelectorAll('.eps-tab')[1].click()`);
  await ctx.wait(200);
  const rows2 = await qa('.ep-row', `({ cur: e.classList.contains('cur'), t: e.querySelector('.ep-t').textContent })`);
  const perSeason2 = eps.filter((e) => e.ParentIndexNumber === 2).length;
  check('Staffel 2 gewaehlt: Reiter und Liste wechseln, keine Folge ist dort die laufende', (await qa('.eps-tab', `e.classList.contains('on')`))[1] === true && rows2.length === perSeason2 && !rows2.some((r) => r.cur), `${rows2.length} Folgen`);
  await ctx.capture(path.join(out, 'EP-02-staffel2.png'), player.overlay);

  // Folge 3 der Staffel 2 anklicken: der Player wechselt
  state.log.length = 0;
  await ev(`document.querySelectorAll('.ep-row')[2].click()`);
  check('Klick auf eine Folge schliesst die Liste', await waitFor(async () => (await q('.pop.eps', 'true')) === null, 1500));
  check('...und der Player wechselt zu dieser Folge (S2E3)', await waitFor(() => player.cur?.item?.Id === ep23.Id && player.state.phase === 'playing', 9000), `aktuell ${player.cur?.item?.Name}`);
  await waitFor(() => state.log.some((l) => l.at === '/Sessions/Playing' && l.ItemId === ep23.Id), 4000);
  const names = state.log.map((l) => `${l.at.replace('/Sessions/', '')}${l.ItemId === ep11.Id ? '(1)' : l.ItemId === ep23.Id ? '(S2E3)' : ''}`);
  check('Server-Log: S1E1 gestoppt, S2E3 gestartet', names.includes('Playing/Stopped(1)') && names.includes('Playing(S2E3)'), names.join(' > '));
  await waitFor(() => player.state.episodes?.length === eps.length, 4000);
  await ctx.wait(400);

  // Erneut oeffnen: Staffel 2 ist gewaehlt, Folge 3 laeuft; Tastatur E und Escape
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))`);
  check('Taste E oeffnet die Liste', await waitFor(popOpen));
  const act = await ev(`({ tab: [...document.querySelectorAll('.eps-tab')].findIndex((b) => b.classList.contains('on')), cur: [...document.querySelectorAll('.ep-row')].findIndex((r) => r.classList.contains('cur')) })`);
  check('Die Liste beginnt bei der Staffel der laufenden Folge (S2) und markiert Folge 3', act.tab === 1 && act.cur === 2, JSON.stringify(act));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Escape schliesst die Liste (der Player bleibt offen)', (await waitFor(async () => (await q('.pop.eps', 'true')) === null, 1500)) && !!player.mpv);
  // Klick auf die laufende Folge: nur schliessen, nicht neu laden
  await ev(`document.querySelector('${BTN}').click()`);
  await waitFor(popOpen);
  const idBefore = player.cur?.item?.Id;
  await ev(`document.querySelector('.ep-row.cur').click()`);
  await ctx.wait(600);
  check('Klick auf die laufende Folge schliesst nur die Liste (kein Neustart)', (await q('.pop.eps', 'true')) === null && player.cur?.item?.Id === idBefore && player.state.phase === 'playing');
  await stop();

  // ---------- Spoiler-Schutz: Bilder ungesehener Folgen verwischt, die laufende nicht ----------
  ctx.config.updateSettings({ general: { spoilerProtection: true } });
  check('Serie startet (Spoiler-Schutz an)', await play(ep11, 100));
  await waitFor(btnShown);
  await ev(`document.querySelector('${BTN}').click()`);
  await waitFor(popOpen);
  const sp = await qa('.ep-th', `e.classList.contains('spoiler')`);
  check('Spoiler-Schutz: die laufende Folge ist scharf, ungesehene sind verwischt', sp[0] === false && sp.slice(1).some(Boolean), JSON.stringify(sp));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await stop();
  ctx.config.updateSettings({ general: { spoilerProtection: false } });

  // ---------- schmales Fenster: nichts ragt heraus ----------
  check('Serie startet (schmales Fenster)', await play(ep11, 100));
  await waitFor(btnShown);
  const win = ctx.win;
  const old = win.getSize();
  win.setSize(760, 640);
  await ctx.wait(700);
  await ev(`document.querySelector('${BTN}').click()`);
  await waitFor(popOpen);
  await ctx.wait(400);
  const narrow = await ev(`(() => { const p = document.querySelector('.pop.eps').getBoundingClientRect(); const bar = document.querySelector('.bar').getBoundingClientRect(); return { l: Math.round(p.left), r: Math.round(p.right), b: Math.round(p.bottom), t: Math.round(p.top), W: innerWidth, barTop: Math.round(bar.top) }; })()`);
  check('Schmales Fenster (760 px): die Liste bleibt im Bild', narrow.l >= 0 && narrow.r <= narrow.W && narrow.t >= 0 && narrow.b <= narrow.barTop + 1, JSON.stringify(narrow));
  await ctx.capture(path.join(out, 'EP-03-schmal.png'), player.overlay);
  win.setSize(old[0], old[1]);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await stop();

  check('Keine Konsolenfehler im Player', errors.length === 0, errors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
