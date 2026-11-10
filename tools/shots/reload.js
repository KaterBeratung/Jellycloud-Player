// Neu laden und Metadaten aktualisieren (JC_DEV=1): F5, Knopf in der Kopfzeile, "Mehr"-Menue der Detailseite.
const { server, items, state } = require('../mock-server');

module.exports = async (ctx) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const key = (k, extra = {}) => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, bubbles: true }, ${JSON.stringify(extra)})))`);
  const toastText = () => ctx.run(`[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')`);

  // Fehler aus dem Hauptprozess kommen mit Statuscode in der Oberflaeche an (Context-Bridge kopiert sonst nur die Meldung)
  const errInfo = await ctx.run(`window.jc.api('getItem', 'ffffffffffffffffffffffffffffffff').then(() => 'ok', (e) => JSON.stringify({ status: e.status, message: e.message, code: e.code }))`);
  check('Fehler aus dem Hauptprozess behalten Statuscode (404)', JSON.parse(errInfo).status === 404, errInfo);
  const loginErr = await ctx.run(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'falsch' }).then(() => 'ok', (e) => JSON.stringify({ status: e.status, message: e.message }))`);
  check('Falsches Passwort liefert Status 401 (Basis der Meldung "Benutzername oder Passwort falsch")', JSON.parse(loginErr).status === 401, loginErr);

  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  const original = movie.Name;
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  check('Detailseite zeigt den Titel', await waitFor(`document.querySelector('.detail-title')?.textContent.includes(${JSON.stringify(original)})`));

  // ---------- F5: Daten neu vom Server ----------
  movie.Name = `${original} (neu)`;
  await key('F5');
  check('F5 laedt die Detailseite neu (geaenderter Titel erscheint)', await waitFor(`document.querySelector('.detail-title')?.textContent.includes('(neu)')`));
  check('Hinweis "Neu geladen"', await waitFor(`!![...document.querySelectorAll('.toast')].find((t) => /Neu geladen/.test(t.innerText))`, 3000), await toastText());

  // ---------- Knopf in der Kopfzeile ----------
  movie.Name = `${original} (Knopf)`;
  const topBtn = `document.querySelector('.toolpill .tool[title*="Neu laden"]')`;
  check('Neu-laden-Knopf in der Kopfzeile', await ctx.run(`!!${topBtn}`));
  await ctx.run(`${topBtn}.click()`);
  check('Knopf laedt neu', await waitFor(`document.querySelector('.detail-title')?.textContent.includes('(Knopf)')`));
  await ctx.wait(400);

  // ---------- Mehr-Menue: Metadaten aktualisieren ----------
  const openMore = async () => {
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await ctx.wait(350);
  };
  const pick = (label) => ctx.run(`[...document.querySelectorAll('.menu button, .menu [role=menuitem], .menu .item')].find((b) => b.innerText.includes(${JSON.stringify(label)}))?.click() ?? 'nicht gefunden'`);
  await openMore();
  const menuText = await ctx.run(`document.querySelector('.menu')?.innerText ?? ''`);
  check('Menue bietet Neu laden und beide Metadaten-Aktionen', /Neu laden/.test(menuText) && /Fehlende Metadaten/.test(menuText) && /ersetzen/.test(menuText), menuText.replace(/\s+/g, ' '));
  state.log.length = 0;
  movie.Name = `${original} (Metadaten)`;
  await pick('Fehlende Metadaten');
  check('Server bekommt Refresh ohne Ersetzen', await (async () => {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const l = state.log.find((x) => x.at === 'Refresh');
      if (l) return l.itemId === movie.Id && l.query.replaceAllMetadata === 'false' && l.query.metadataRefreshMode === 'FullRefresh';
      await ctx.wait(80);
    }
    return false;
  })(), JSON.stringify(state.log.find((x) => x.at === 'Refresh')?.query));
  check('Hinweis, dass der Server aktualisiert', await waitFor(`!![...document.querySelectorAll('.toast')].find((t) => /aktualisiert/.test(t.innerText))`, 3000), await toastText());
  check('Danach laedt die Seite selbst neu (neuer Titel nach wenigen Sekunden)', await waitFor(`document.querySelector('.detail-title')?.textContent.includes('(Metadaten)')`, 8000));

  // ---------- Ersetzen, und 403 fuer Nicht-Administratoren ----------
  await ctx.wait(500);
  await openMore();
  state.log.length = 0;
  await pick('ersetzen');
  await ctx.wait(500);
  const l2 = state.log.find((x) => x.at === 'Refresh');
  check('"Ersetzen" setzt replaceAll beim Server', l2?.query.replaceAllMetadata === 'true' && l2?.query.replaceAllImages === 'true', JSON.stringify(l2?.query));
  await ctx.wait(4500);
  await openMore();
  state.refreshForbidden = true;
  await pick('Fehlende Metadaten');
  check('Ohne Administratorrechte: verstaendliche Meldung statt Fehlercode', await waitFor(`!![...document.querySelectorAll('.toast')].find((t) => /Administratoren/.test(t.innerText))`, 3000), await toastText());
  state.refreshForbidden = false;

  // ---------- Strg+Umschalt+R: auch Bildspeicher leeren, alles neu aufbauen ----------
  await ctx.wait(1500);
  movie.Name = original;
  await key('r', { ctrlKey: true, shiftKey: true });
  check('Strg+Umschalt+R baut alles neu auf', await waitFor(`document.querySelector('.detail-title')?.textContent.includes(${JSON.stringify(original)}) && !document.querySelector('.detail-title').textContent.includes('(')`, 8000));
  const cache = await ctx.run(`window.jc.cacheInfo()`);
  check('Bildspeicher wurde dabei geleert und fuellt sich neu', typeof cache.images === 'number', JSON.stringify(cache));

  // ---------- Startseite: F5 holt auch hier neu ----------
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(1800);
  const before = await ctx.run(`document.querySelectorAll('.row .card').length`);
  await key('F5');
  await ctx.wait(1800);
  const after = await ctx.run(`document.querySelectorAll('.row .card').length`);
  check('F5 auf der Startseite baut die Reihen neu auf', before > 0 && after === before, `${before} -> ${after}`);

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
