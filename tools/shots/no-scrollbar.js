// Kein Scrollbalken in der Oberflaeche (Windows-Programm): weder am Fensterrand noch in Menues, Dialogen und Listen, und es bleibt kein Streifen reserviert (der Inhalt nutzt die volle Breite).
// Gescrollt wird trotzdem: Mausrad und Tastatur (Bild runter) auf Startseite, Film, Einstellungen und Bibliothek. Aufnahme der Startseite nach dem Scrollen in SHOT_DIR.
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
  ctx.win.setContentSize(1280, 720);
  await ctx.wait(500);
  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  const libHref = await ctx.run(`document.querySelector('.nav-link[href^="#/library/"]')?.getAttribute('href')`);

  const wc = ctx.win.webContents;
  const pages = [
    ['Startseite', '#/home', '.home .rows .row'],
    ['Filmseite', `#/item/${movie.Id}`, '.detail .detail-actions .btn'],
    ['Einstellungen', '#/settings/appearance', '.settings-nav .snav.on'],
    ['Bibliothek', libHref, '.library .card']
  ];
  for (const [label, hash, ready] of pages) {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await waitFor(`!!document.querySelector(${JSON.stringify(ready)})`, 10000);
    await ctx.wait(1300);
    const m = await ctx.run(`(() => { const v = document.querySelector('#view'); return { sbw: getComputedStyle(v).scrollbarWidth, gutter: v.offsetWidth - v.clientWidth, full: v.clientWidth === document.documentElement.clientWidth, w: v.clientWidth, can: v.scrollHeight > v.clientHeight + 100 }; })()`);
    check(`${label}: kein Scrollbalken und kein reservierter Streifen am Rand`, m.sbw === 'none' && m.gutter === 0 && m.full, JSON.stringify(m));
    check(`${label}: die Seite ist laenger als das Fenster (Scrollen ist moeglich)`, m.can === true);
    // Eingabe nur ins Fenster, das gerade Fokus hat (in der VM verliert es ihn zwischendurch, dann werden Eingaben verschluckt): bis zu drei Versuche
    const tryInput = async (reset, send) => {
      let top = 0;
      for (let attempt = 0; attempt < 3 && !(top > 50); attempt++) {
        ctx.win.show();
        ctx.win.focus();
        wc.focus();
        await ctx.run(reset);
        await ctx.wait(200);
        send();
        await ctx.wait(800);
        top = await ctx.run(`document.querySelector('#view').scrollTop`);
      }
      return top;
    };
    // Mausrad
    const wheel = await tryInput(`document.querySelector('#view').scrollTop = 0`, () => {
      wc.sendInputEvent({ type: 'mouseMove', x: 640, y: 360 });
      wc.sendInputEvent({ type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: -480, canScroll: true });
    });
    check(`${label}: Mausrad scrollt ohne Balken`, wheel > 50, `scrollTop=${Math.round(wheel)}`);
    // Tastatur: Bild runter
    const key = await tryInput(`(() => { const v = document.querySelector('#view'); v.scrollTop = 0; v.focus(); })()`, () => {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'PageDown' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'PageDown' });
    });
    check(`${label}: Bild-runter-Taste scrollt ohne Balken`, key > 50, `scrollTop=${Math.round(key)}`);
    if (label === 'Startseite' && out) {
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(out, 'n-1-startseite-gescrollt.png'), img.toPNG());
    }
  }

  // Alles, was scrollen kann (jetzt im DOM) und jede Stylesheet-Regel: nirgends ein sichtbarer Balken, auch nicht in Menues und Dialogen, die gerade nicht offen sind
  const all = await ctx.run(`(() => {
    const bad = [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY + getComputedStyle(el).overflowX) && getComputedStyle(el).scrollbarWidth !== 'none').map((el) => el.tagName + '.' + el.className);
    const rules = [];
    for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.style && /^(thin|auto)$/.test(r.style.scrollbarWidth)) rules.push(r.selectorText);
    const wk = [];
    for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.selectorText && /::-webkit-scrollbar/.test(r.selectorText) && r.style.display !== 'none') wk.push(r.selectorText);
    return { bad: bad.slice(0, 5), rules: rules.slice(0, 5), wk: wk.slice(0, 5) };
  })()`);
  check('Alle scrollbaren Elemente haben scrollbar-width: none', all.bad.length === 0, JSON.stringify(all.bad));
  check('Keine Stylesheet-Regel schaltet einen Balken ein (scrollbar-width thin/auto)', all.rules.length === 0, JSON.stringify(all.rules));
  check('Keine ::-webkit-scrollbar-Regel zeigt einen Balken', all.wk.length === 0, JSON.stringify(all.wk));

  // Ein geoeffnetes Menue (Sortierung in der Bibliothek): auch dort kein Balken
  await ctx.run(`location.hash = ${JSON.stringify(libHref)}`);
  const SORT_BTN = `[...document.querySelectorAll('.lib-controls .btn')].find((b) => /Sortier|Sort/.test(b.textContent))`;
  const hasSelect = await waitFor(`!!(${SORT_BTN})`, 8000);
  await ctx.wait(800);
  if (hasSelect) {
    await ctx.run(`(${SORT_BTN}).click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 4000);
  }
  const menuInfo = await ctx.run(`(() => { const m = document.querySelector('.menu.open'); if (!m) return null; const cs = getComputedStyle(m); return { sbw: cs.scrollbarWidth, gutter: m.offsetWidth - m.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth), items: m.querySelectorAll('.menu-item').length }; })()`);
  check('Geoeffnetes Auswahlmenue (Sortierung): es ist offen und hat keinen Balken', !!menuInfo && menuInfo.items >= 2 && menuInfo.sbw === 'none' && Math.abs(menuInfo.gutter) < 1, JSON.stringify(menuInfo)); // < 1 px: bei 125 % Skalierung faellt der Rand auf 0,8 px, ein Balken waere mindestens 8 px breit

  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
