// Glas-Knoepfe ohne Weichzeichner (backdrop-filter): Beim Darueberfahren zeigte ein Knopf einen senkrechten, geradlinigen Streifen (Kachelfehler der Grafikkarte, wenn der Weichzeichner
// ein laufendes Video hinter sich liest). Das Video laeuft schon unsichtbar, bevor der Trailer einblendet - die Knoepfe haben deshalb in JEDEM Zustand keinen Weichzeichner:
// ohne Trailer, waehrend er noch unsichtbar laedt/laeuft, nach dem Einblenden, beim Darueberfahren, auf der Filmseite (Auswahlfelder) und im Banner der Startseite.
// Aufnahmen der Aktionsleiste (vergroessert) landen in SHOT_DIR.
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..', '..');
const { server, items } = require(path.join(root, 'tools', 'mock-server'));

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR;
  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(50);
    }
    return false;
  };
  const YT = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  series.RemoteTrailers = YT;
  movie.RemoteTrailers = YT;
  ctx.win.setContentSize(1280, 720);
  await ctx.wait(400);

  // Lesen: Weichzeichner und Fuellung jedes Knopfes der Aktionsleiste (Vorlage fuer mehrere Zeitpunkte)
  const BTN_JS = `[...document.querySelectorAll('.detail-actions .btn.glass')].map((e) => { const s = getComputedStyle(e); return { t: (e.title || e.textContent.trim() || '?').slice(0, 14), on: e.classList.contains('on'), bf: s.backdropFilter, bg: s.backgroundImage + '|' + s.backgroundColor }; })`;
  const allNone = (list) => list.length > 0 && list.every((b) => b.bf === 'none');
  const crop = async (name) => {
    const bar = await ctx.run(`(() => { const b = document.querySelector('.detail-actions').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    const rect = { x: Math.max(0, bar.x - 20), y: Math.max(0, bar.y - 20), width: Math.min(1280 - Math.max(0, bar.x - 20), bar.w + 60), height: bar.h + 40 };
    const img = await ctx.win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(out, name), img.resize({ width: img.getSize().width * 3, quality: 'best' }).toPNG());
  };
  const hoverEach = async (label) => {
    // Nur sichtbare Knoepfe (der Ton-Knopf bleibt versteckt, bis der Trailer einblendet)
    const btns = await ctx.run(`[...document.querySelectorAll('.detail-actions .btn.glass')].map((e, idx) => { const b = e.getBoundingClientRect(); return { idx, vis: b.width > 0 && b.height > 0, t: (e.title || e.textContent.trim() || '?').slice(0, 14), x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; }).filter((b) => b.vis)`);
    let allOk = true, changed = 0;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: b.x - 6, y: b.y });
      await ctx.wait(60);
      ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y });
      await ctx.wait(450);
      const st = await ctx.run(`(() => { const e = document.querySelectorAll('.detail-actions .btn.glass')[${b.idx}]; const s = getComputedStyle(e); return { bf: s.backdropFilter, hov: e.matches(':hover'), bg: s.backgroundImage + '|' + s.backgroundColor }; })()`);
      if (st.bf !== 'none') allOk = false;
      if (st.hov) changed++;
    }
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 400 });
    await ctx.wait(300);
    check(`${label}: beim Darueberfahren bleibt jeder Knopf ohne Weichzeichner (${btns.length} Knoepfe)`, allOk && btns.length >= 4);
    check(`${label}: der Zeiger liegt beim Darueberfahren wirklich auf dem Knopf (Hover greift)`, changed === btns.length, `${changed} von ${btns.length}`);
  };

  // ---- 1) Seriendetail ohne Trailer ----
  ctx.config.updateSettings({ trailer: { autoplay: false, muted: true, delaySec: 0, quality: '720', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  await waitFor(`!!document.querySelector('.detail-actions .btn.glass')`, 10000);
  await ctx.wait(900);
  const noTr = await ctx.run(BTN_JS);
  console.log('OHNE TRAILER ' + JSON.stringify(noTr.map((b) => b.t + ':' + b.bf)));
  check('Serie ohne Trailer: kein Knopf der Aktionsleiste hat einen Weichzeichner', allNone(noTr), `${noTr.length} Knoepfe`);
  await crop('b-1-ohne-trailer.png');
  await hoverEach('Serie ohne Trailer');

  // ---- 2) Seriendetail mit Trailer: vor dem Einblenden (Video laeuft schon, Ebene noch unsichtbar), danach ----
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 0, quality: '720', focusSec: 0 } });
  await ctx.run(`location.hash = '#/'`);
  await ctx.wait(1200);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  await waitFor(`!!document.querySelector('.detail-actions .btn.glass')`, 10000);
  let pre = 0, post = 0, bad = 0, firstBad = '';
  const end = Date.now() + 60000;
  let hovered = false;
  while (Date.now() < end) {
    const s = await ctx.run(`(() => { const l = document.querySelector('.trailer'); return { frame: !!(l && l.querySelector('iframe')), on: !!(l && l.classList.contains('on')), btns: ${BTN_JS} }; })()`);
    if (s.frame && !s.on) pre++;
    if (s.on) post++;
    if (!allNone(s.btns)) { bad++; if (!firstBad) firstBad = JSON.stringify(s.btns.map((b) => b.t + ':' + b.bf)); }
    if (s.frame && !s.on && !hovered) {
      // Vor dem Einblenden ueber einen Knopf fahren (hier trat der Streifen auf)
      hovered = true;
      await crop('b-2-vor-einblenden.png');
      await hoverEach('Serie, Trailer laeuft noch unsichtbar');
    }
    if (post >= 3) break;
    await ctx.wait(120);
  }
  console.log(`STUFEN: ${pre} Messungen vor dem Einblenden, ${post} nach dem Einblenden`);
  check('Serie mit Trailer: in keiner Messung (vor und nach dem Einblenden) hat ein Knopf einen Weichzeichner', bad === 0 && post >= 3, bad ? firstBad : `${pre + post} Messungen`);
  check('Der Lauf hat den Zustand "Video laeuft, Ebene noch unsichtbar" erwischt', pre >= 1, `${pre} Messungen`);
  await ctx.wait(800);
  const shown = await ctx.run(BTN_JS);
  const tinted = (b) => b.bg.includes('rgba(16, 18, 30');
  check('Nach dem Einblenden: weiter ohne Weichzeichner, getoente dunkle Glasflaeche', allNone(shown) && shown.filter((b) => !b.on).every(tinted), shown.filter((b) => !b.on).filter((b) => !tinted(b)).map((b) => b.t).join(', '));
  await crop('b-3-nach-einblenden.png');
  await hoverEach('Serie, Trailer sichtbar');

  // ---- 3) Filmseite: Aktionsleiste und Auswahlfelder ----
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await waitFor(`!!document.querySelector('.detail-options .opt')`, 15000);
  await ctx.wait(700);
  const opts = await ctx.run(`[...document.querySelectorAll('.detail-options .opt')].map((e) => getComputedStyle(e).backdropFilter)`);
  check('Film: die Auswahlfelder (Version, Ton, Untertitel) haben keinen Weichzeichner', opts.length >= 2 && opts.every((v) => v === 'none'), JSON.stringify(opts));
  check('Film: die Knoepfe der Aktionsleiste haben keinen Weichzeichner', allNone(await ctx.run(BTN_JS)));

  // ---- 4) Banner der Startseite ----
  await ctx.run(`location.hash = '#/'`);
  await waitFor(`!!document.querySelector('.hero-slide.active .btn.glass')`, 15000);
  await ctx.wait(600);
  const hero = await ctx.run(`[...document.querySelectorAll('.hero-slide .btn.glass')].map((e) => getComputedStyle(e).backdropFilter)`);
  check('Startseite: die Glas-Knoepfe im Banner haben keinen Weichzeichner', hero.length >= 1 && hero.every((v) => v === 'none'), `${hero.length} Knoepfe`);

  // ---- 5) Gegenprobe: andere Glasflaechen behalten den Weichzeichner (Kopfleiste, Menues) ----
  const pill = await ctx.run(`(() => { const e = document.querySelector('.navpill, .toolpill'); return e ? getComputedStyle(e).backdropFilter : 'fehlt'; })()`);
  check('Gegenprobe: die Kopfleiste behaelt ihren Weichzeichner', pill !== 'none' && pill !== 'fehlt', pill);

  console.log(`Ergebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
};
