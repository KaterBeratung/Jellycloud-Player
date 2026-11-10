// Szenario fuer automatische Screenshots (nur mit JC_DEV=1):
//   $env:JC_DEV='1'; npx electron . --user-data-dir=<tmp> --shots=tools/shots/ui.js
const path = require('node:path');
const { server } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    const level = e.level;
    if (level === 'error' || level === 'warning' || level >= 2) errors.push(`[${level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  const shot = async (name, ms = 900) => {
    await ctx.wait(ms);
    await ctx.capture(path.join(out, `${name}.png`));
  };
  const go = async (hash, ms = 1400) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await shot(`x`, 10);
    await ctx.wait(ms);
  };

  await shot('01-login', 1200);
  // Falsche Anmeldung -> Fehlermeldung
  await ctx.run(`(async () => {
    const [url, user, pass] = document.querySelectorAll('.login-form input');
    url.value = '127.0.0.1:8097'; user.value = 'demo'; pass.value = 'falsch';
    document.querySelector('.login-form').requestSubmit();
  })()`);
  await shot('02-login-error', 1200);
  await ctx.run(`(async () => {
    const [url, user, pass] = document.querySelectorAll('.login-form input');
    pass.value = 'demo';
    document.querySelector('.login-form').requestSubmit();
  })()`);
  await ctx.wait(3500);
  await shot('03-home', 1500);
  await ctx.run(`document.querySelector('#view').scrollTo({top: 640})`);
  await shot('04-home-scrolled', 900);
  const libId = await ctx.run(`document.querySelectorAll('.nav-link')[1]?.getAttribute('href')`);
  await go(libId, 2200);
  await shot('05-library', 900);
  const movieHref = await ctx.run(`document.querySelector('.grid .card a, .grid a.card')?.getAttribute('href')`);
  await go(movieHref, 2600);
  await shot('06-detail-movie', 800);
  await ctx.run(`document.querySelector('#view').scrollTo({top: 700})`);
  await shot('07-detail-scrolled', 900);
  const showHref = await ctx.run(`(async () => { location.hash = document.querySelectorAll('.nav-link')[2].getAttribute('href'); await new Promise(r => setTimeout(r, 1600)); return document.querySelector('.grid a.card').getAttribute('href'); })()`);
  await go(showHref, 3000);
  await shot('08-detail-series', 800);
  await go('#/settings/appearance', 1200);
  await shot('09-settings-appearance', 600);
  await go('#/settings/playback', 1200);
  await shot('10-settings-playback', 600);
  await go('#/search?q=aur', 1800);
  await shot('11-search', 600);

  // Alles Anklickbare muss beim Daruebergehen die Hand zeigen (Buttons haben sie von Haus aus nicht): Kopfzeile, Detailseite, Einstellungen, Suche
  const audit = `(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button:not(:disabled), a[href], [role="button"], summary, select')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[hidden]')) continue;
      const c = getComputedStyle(el).cursor;
      if (c !== 'pointer') bad.push((el.className || el.tagName) + ' -> ' + c + ' [' + (el.title || el.textContent || '').trim().slice(0, 24) + ']');
    }
    return bad;
  })()`;
  const cursorProblems = [];
  for (const hash of ['#/home', movieHref, '#/settings/playback', '#/settings/appearance', '#/search?q=aur']) {
    await go(hash, 1400);
    for (const b of await ctx.run(audit)) cursorProblems.push(`${hash}: ${b}`);
  }
  console.log('Hand-Cursor bei allem Anklickbaren:', cursorProblems.length ? `\n${[...new Set(cursorProblems)].join('\n')}` : 'ueberall');
  const reloadCursor = await ctx.run(`getComputedStyle(document.querySelector('.toolpill button[aria-label="Neu laden"], .toolpill button[title^="Neu laden"]')).cursor`);
  console.log(`${reloadCursor === 'pointer' ? 'PASS' : 'FAIL'}  Neu-laden-Knopf oben rechts zeigt die Hand (${reloadCursor})`);
  if (cursorProblems.length || reloadCursor !== 'pointer') process.exitCode = 1;

  // Nichts darf sich per Drag and Drop aus der Oberflaeche ziehen lassen (Links, Bilder, Karten), nichts darf darauf abgelegt werden
  const dragReport = await ctx.run(`(() => {
    const out = { dragable: [], navPrevented: null, cardPrevented: null, imgPrevented: null, inputAllowed: null, dragoverPrevented: null, dropPrevented: null, links: 0 };
    for (const el of document.querySelectorAll('a, img')) { out.links++; if (getComputedStyle(el).getPropertyValue('-webkit-user-drag') !== 'none') out.dragable.push(el.className || el.tagName); }
    const fire = (el, type) => { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }); el.dispatchEvent(e); return e.defaultPrevented; };
    out.navPrevented = fire(document.querySelector('.nav-link, .toolpill a'), 'dragstart');
    const card = document.querySelector('a.card, .card a');
    out.cardPrevented = card ? fire(card, 'dragstart') : null;
    const img = document.querySelector('img');
    out.imgPrevented = img ? fire(img, 'dragstart') : null;
    const input = document.querySelector('input.search-input');
    out.inputAllowed = input ? !fire(input, 'dragstart') : null;
    out.dragoverPrevented = fire(document.body, 'dragover');
    out.dropPrevented = fire(document.body, 'drop');
    return out;
  })()`);
  const dragOk = dragReport.dragable.length === 0 && dragReport.navPrevented && dragReport.cardPrevented !== false && dragReport.imgPrevented !== false && dragReport.inputAllowed !== false && dragReport.dragoverPrevented && dragReport.dropPrevented;
  console.log(`${dragOk ? 'PASS' : 'FAIL'}  Kein Drag and Drop aus der Oberflaeche (Links/Bilder ohne Ziehbild, dragstart/dragover/drop gesperrt, Eingabefelder ausgenommen)  ${JSON.stringify(dragReport)}`);
  if (!dragOk) process.exitCode = 1;

  console.log('Konsolenfehler:', errors.length ? `\n${errors.join('\n')}` : 'keine');
  server.close();
};
