// Zustaende einer Seite und Grundmasse der Bedienelemente (P5, nach PageStatus, FieldStyles und PressFeedback der Apple-App), mit dem Mock-Server auf eigenem Port 8996:
//  - Leer und Fehler als ein Baustein (pageStatus): als ganze Seite in der Mitte des Inhaltsbereichs, "Erneut versuchen" darunter verschiebt den Hinweis nicht,
//    die Flaeche nimmt keine Eingaben an (Kopfzeile und Filter bleiben bedienbar), ein zweiter Klick waehrend des Versuchs bleibt ohne Wirkung
//  - Mediathek: Fehler beim Nachladen steht am Ende der Liste, das Geladene bleibt, nichts laedt von selbst nach
//  - Detailseite ohne Titel: Fehler fuer die ganze Seite, ein erneuter Fehlschlag zeigt genau einen Hinweis
//  - Druecken: Knopf 0,94 und blasser, Karte 0,95 und dunkler, danach zurueck; Felder so hoch wie die Knoepfe (48), Kapsel
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/page-status.js
const path = require('node:path');
const { server, state, addMovies, MOVIES_VIEW } = require('../mock-server');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const PORT = 8996;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  addMovies(140); // mehr als eine Seite (60) in der Mediathek
  await ctx.wait(400);
  ctx.win.setContentSize(1440, 900);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  const wc = ctx.win.webContents;
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 9000);
    await ctx.wait(500);
  };

  /** Lage des Hinweises (sichtbarer, nicht gesperrter): Mitte, Abstand zum Knopf, Mitte des Inhaltsbereichs (unter der Kopfleiste bis zum Fensterrand) */
  const GEO = `(() => {
    const st = [...document.querySelectorAll('.page-status')].find((s) => s.offsetParent || s.getClientRects().length);
    if (!st) return null;
    const n = st.querySelector('.ps-notice').getBoundingClientRect();
    const b = st.querySelector('.ps-action .btn')?.getBoundingClientRect();
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    return { kind: st.dataset.kind, inline: st.classList.contains('inline'), cy: (n.top + n.bottom) / 2, cx: (n.left + n.right) / 2, areaCy: (bar.bottom + innerHeight) / 2, areaCx: innerWidth / 2,
      gap: b ? Math.round((b.top - n.bottom) * 10) / 10 : null, btnH: b ? Math.round(b.height) : null, btnText: st.querySelector('.ps-action .btn')?.textContent.trim() ?? '',
      btnGlass: !!st.querySelector('.ps-action .btn.glass'), count: document.querySelectorAll('.page-status').length, pe: getComputedStyle(st).pointerEvents };
  })()`;
  const centred = (g) => !!g && Math.abs(g.cy - g.areaCy) <= 2 && Math.abs(g.cx - g.areaCx) <= 2;

  // ---------- Mediathek: Fehler beim ersten Laden (die Mediathek selbst kommt nicht an) ----------
  state.faults.lists = { how: '500', left: 1 };
  await go(`#/library/${MOVIES_VIEW.Id}`, `!!document.querySelector('.library .page-status')`);
  const failed = await ctx.run(GEO);
  check('Mediathek, Fehler beim Laden: ein Hinweis fuer die ganze Seite mit "Erneut versuchen"', !!failed && failed.kind === 'failed' && !failed.inline && failed.btnText === 'Erneut versuchen' && failed.btnGlass, JSON.stringify(failed));
  check('...in der Mitte des Inhaltsbereichs (unter der Kopfleiste)', centred(failed), failed && `Mitte ${Math.round(failed.cy)} / ${Math.round(failed.areaCy)}, ${Math.round(failed.cx)} / ${Math.round(failed.areaCx)}`);
  check('...der Knopf haengt 18 unter dem Hinweis und ist so hoch wie jeder Knopf (48)', !!failed && Math.abs(failed.gap - 18) <= 1 && failed.btnH === 48, failed && `${failed.gap} / ${failed.btnH}`);
  await ctx.capture(path.join(out, 'PS-mediathek-fehler.png'));

  // Zweiter Klick waehrend des Versuchs: der Knopf ist gesperrt, danach steht das Raster
  state.delays.items = 700;
  await ctx.run(`document.querySelector('.page-status .ps-action .btn').click()`);
  await ctx.wait(60);
  const during = await ctx.run(`(() => { const b = document.querySelector('.page-status .ps-action .btn'); return b ? { disabled: b.disabled } : { gone: true }; })()`);
  await ctx.run(`document.querySelector('.page-status .ps-action .btn')?.click()`);
  check('"Erneut versuchen": waehrend des Versuchs gesperrt (ein zweiter Klick bleibt ohne Wirkung)', during.disabled === true || during.gone === true, JSON.stringify(during));
  const cardsBack = await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 60 && !document.querySelector('.library .page-status')`, 6000);
  state.delays.items = 0;
  check('...danach steht das Raster (erste Seite), kein Hinweis mehr', cardsBack, String(await ctx.run(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length`)));

  // ---------- Mediathek: Fehler nach einem Filterwechsel (Kopfzeile mit Filtern steht) ----------
  await ctx.wait(500);
  state.faults.lists = { how: '500', left: 1 };
  await ctx.run(`[...document.querySelectorAll('.lib-controls .seg')].find((b) => /Ungesehen/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.library .page-status[data-kind="failed"]')`, 6000);
  await ctx.wait(300);
  const failed2 = await ctx.run(GEO);
  const under = await ctx.run(`(() => { const c = [...document.querySelectorAll('.lib-controls .seg')].find((b) => /Alle/.test(b.textContent)); if (!c) return { none: true }; const r = c.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { ok: hit === c || c.contains(hit), hit: hit ? hit.tagName + '.' + hit.className : null }; })()`);
  check('Filterwechsel gescheitert: Hinweis in der Mitte, die Flaeche nimmt keine Eingaben an (Filter darueber bleiben bedienbar)', centred(failed2) && failed2.pe === 'none' && under.ok === true, `${JSON.stringify(failed2)} ${JSON.stringify(under)}`);
  await ctx.wait(1500);
  const kept = await ctx.run(`({ s: document.querySelectorAll('.library .page-status[data-kind="failed"]').length, n: document.querySelectorAll('.library .grid .card').length })`);
  check('...der Hinweis bleibt stehen: kein ungefragter neuer Versuch (der Beobachter am Listenende laedt nicht von selbst)', kept.s === 1 && kept.n === 0, JSON.stringify(kept));
  await ctx.run(`[...document.querySelectorAll('.lib-controls .seg')].find((b) => /Alle/.test(b.textContent)).click()`);
  check('...ein anderer Filter laedt wieder, der Hinweis ist weg', await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 60 && !document.querySelector('.library .page-status')`, 6000));

  // ---------- Mediathek: Fehler beim Nachladen ----------
  await ctx.wait(600);
  state.faults.lists = { how: '500', left: 1 };
  await ctx.run(`document.querySelector('#view').scrollTop = 1e6`);
  const moreShown = await waitFor(`!!document.querySelector('.library .grid > .page-status.inline')`, 6000);
  const keep = await ctx.run(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length`);
  const diag = await ctx.run(`(() => { const v = document.querySelector('#view'); const s = document.querySelector('.library .sentinel').getBoundingClientRect(); return { top: Math.round(v.scrollTop), h: v.scrollHeight, sentinel: Math.round(s.top), inner: innerHeight }; })()`);
  check('Nachladen gescheitert: der Fehler steht am Ende der Liste, das Geladene bleibt', moreShown && keep === 60, `${moreShown} / ${keep} Karten ${JSON.stringify(diag)} Fehler offen: ${JSON.stringify(state.faults)}`);
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.wait(400);
  await ctx.run(`document.querySelector('#view').scrollTop = 1e6`);
  await ctx.wait(1500);
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.wait(400);
  await ctx.run(`document.querySelector('#view').scrollTop = 1e6`);
  await ctx.wait(1500);
  const still = await ctx.run(`({ n: document.querySelectorAll('.library .grid .card:not(.sk-card)').length, s: document.querySelectorAll('.library .page-status').length })`);
  check('...es laedt nicht von selbst nach (kein Dauerversuch beim Scrollen)', still.n === 60 && still.s === 1, JSON.stringify(still));
  await ctx.capture(path.join(out, 'PS-nachladen-fehler.png'));
  await ctx.run(`document.querySelector('.library .grid > .page-status .ps-action .btn').click()`);
  check('..."Erneut versuchen" laedt die naechste Seite, der Hinweis ist weg', await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 60 && !document.querySelector('.library .page-status')`, 6000), String(await ctx.run(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length`)));

  // ---------- Mediathek: leer (Favoriten ohne Eintraege) ----------
  const favs = [...state.fav];
  state.fav.clear();
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.run(`[...document.querySelectorAll('.lib-controls .seg')].find((b) => /Favoriten/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.library .page-status[data-kind="empty"]')`, 6000);
  await ctx.wait(300);
  const empty = await ctx.run(GEO);
  check('Leer (Filter ohne Treffer): Hinweis ohne Knopf an derselben Stelle wie der Fehler mit Knopf', !!empty && empty.kind === 'empty' && empty.btnText === '' && centred(empty) && Math.abs(empty.cy - failed.cy) <= 1, empty && `${Math.round(empty.cy)} / ${Math.round(failed.cy)}`);
  await ctx.capture(path.join(out, 'PS-mediathek-leer.png'));
  favs.forEach((f) => state.fav.add(f));
  await ctx.run(`[...document.querySelectorAll('.lib-controls .seg')].find((b) => /Alle/.test(b.textContent)).click()`);
  await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0`, 6000);

  // ---------- Druecken: Knopf und Karte ----------
  // fy: Hoehe des Druckpunkts im Element (Karten oben im Bild, nicht auf dem Abspielknopf in der Mitte)
  const press = async (sel, inner = null, fy = 0.5) => {
    const pt = await ctx.run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height * ${fy})]; })()`);
    const read = `(() => { const e = document.querySelector(${JSON.stringify(inner ?? sel)}); if (!e) return { gone: true }; const cs = getComputedStyle(e); return { scale: cs.scale, opacity: cs.opacity, filter: cs.filter }; })()`;
    wc.sendInputEvent({ type: 'mouseMove', x: pt[0], y: pt[1] });
    await ctx.wait(300);
    wc.sendInputEvent({ type: 'mouseDown', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
    await ctx.wait(220);
    const down = await ctx.run(read);
    wc.sendInputEvent({ type: 'mouseUp', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
    await ctx.wait(500);
    const up = await ctx.run(read);
    return { down, up };
  };
  const sortBtn = '.lib-controls .btn:last-child';
  const p1 = await press(sortBtn);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);
  check('Druecken eines Knopfs: sofort kleiner (0,94) und blasser (0,72), danach zurueck', p1.down.scale === '0.94' && Math.abs(Number(p1.down.opacity) - 0.72) < 0.02 && (p1.up.scale === 'none' || p1.up.scale === '1') && Number(p1.up.opacity) === 1, JSON.stringify(p1));
  const p2 = await press('.library .grid .card:not(.sk-card) .thumb', '.library .grid .card:not(.sk-card) .thumb', 0.2);
  check('Druecken einer Karte: das Bild federt ein (0,95) und dunkelt ab, danach zurueck (Detailseite geoeffnet)', p2.down.scale === '0.95' && /brightness\(0\.95\)/.test(p2.down.filter) && (await waitFor(`location.hash.startsWith('#/item/')`, 3000)), JSON.stringify(p2));

  // ---------- Detailseite ohne Titel ----------
  await go('#/item/deadbeefdeadbeefdeadbeefdeadbeef', `!!document.querySelector('.detail .page-status')`);
  const det = await ctx.run(GEO);
  check('Detailseite, Titel nicht geladen: Fehler fuer die ganze Seite, in der Mitte, mit "Erneut versuchen"', !!det && det.kind === 'failed' && !det.inline && centred(det) && det.btnText === 'Erneut versuchen', JSON.stringify(det));
  await ctx.run(`document.querySelector('.detail .page-status .ps-action .btn').click()`);
  await ctx.wait(1200);
  const det2 = await ctx.run(GEO);
  check('...ein erneuter Fehlschlag zeigt wieder genau einen Hinweis (keinen zweiten, keinen Platzhalter)', !!det2 && det2.count === 1 && (await ctx.run(`!document.querySelector('.detail .detail-loading')`)), JSON.stringify(det2));

  // ---------- Suche: Hinweis vor der Eingabe ----------
  await go('#/search', `!!document.querySelector('.search-results .page-status')`);
  const hint = await ctx.run(GEO);
  check('Suche ohne Eingabe: Hinweis in der Mitte des Inhaltsbereichs', !!hint && hint.kind === 'empty' && centred(hint), JSON.stringify(hint));
  check('...das Suchfeld darueber bleibt bedienbar (der Hinweis faengt keine Klicks ab)', await ctx.run(`(() => { const r = document.querySelector('.search-input').getBoundingClientRect(); return document.elementFromPoint(r.left + 40, r.top + r.height / 2) === document.querySelector('.search-input'); })()`));

  // ---------- Felder und Knoepfe: Kapseln gleicher Hoehe ----------
  await go('#/settings/seerr', `!!document.querySelector('.settings-panel input.field')`);
  const fields = await ctx.run(`(() => { const f = document.querySelector('.settings-panel input.field'); const b = document.querySelector('.settings-panel .btn.primary'); const fs = getComputedStyle(f); return { f: Math.round(f.getBoundingClientRect().height), b: b ? Math.round(b.getBoundingClientRect().height) : null, radius: parseFloat(fs.borderTopLeftRadius), pad: fs.paddingLeft }; })()`);
  check('Eingabefeld: Kapsel, so hoch wie der Hauptknopf (48), 20 seitlich', fields.f === 48 && fields.b === 48 && fields.radius >= 24 && fields.pad === '20px', JSON.stringify(fields));
  await go('#/settings/appearance', `!!document.querySelector('.field.hex')`);
  await ctx.run(`(() => { const f = document.querySelector('.field.hex'); f.focus(); f.value = '#1234567'; f.dispatchEvent(new Event('input')); })()`);
  await ctx.wait(450); // der Schatten blendet ueber (Uebergang des Felds)
  const bad = await ctx.run(`(() => { const f = document.querySelector('.field.hex'); return { invalid: f.classList.contains('invalid'), shadow: getComputedStyle(f).boxShadow }; })()`);
  check('Fehlerhafte Eingabe: Kontur 1,5 in der Fehlerfarbe (#ff6b86)', bad.invalid && /rgba\(255, 107, 134, 0\.9\) 0px 0px 0px 1\.5px inset/.test(bad.shadow), JSON.stringify(bad));
  await ctx.run(`(() => { const f = document.querySelector('.field.hex'); f.value = '#F5F5F7'; f.dispatchEvent(new Event('input')); f.blur(); })()`);

  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  server.close();
  if (fail) process.exitCode = 1;
};
