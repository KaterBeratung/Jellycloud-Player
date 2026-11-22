// Reiter "Anfragen" (P11, nach RequestsView der Apple-App), mit dem Mock-Server auf Port 8991:
//  - normaler Benutzer: nur "Meine Anfragen", Offen/Abgeschlossen, Plakatraster mit Stand-Tag, Titel und Jahr nachgeladen, nur "Zurueckziehen" fuer
//    eigene wartende (mit Rueckfrage); Antippen oeffnet den Titel
//  - mit "Anfragen verwalten": "Verwalten" mit fremden Anfragen ("von ben"), Genehmigen, Ablehnen und Entfernen (mit Rueckfrage); entzogenes Recht
//    schliesst "Verwalten"
//  - Blaettern zu je 50: die offenen liegen hinter 120 abgeschlossenen, der Reiter blaettert von selbst weiter; Neuladen holt so viel, wie da war
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/requests-tab.js
const path = require('node:path');
const { server, state, SEERR } = require('../mock-server');

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
  const PORT = 8991;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' });

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  SEERR.permissions = 32; // ein normaler Benutzer: anfragen, nicht verwalten
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
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
    await ctx.wait(400);
  };
  const relogin = async () => {
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await waitFor(`!!document.querySelector('.topbar')`, 8000);
    await ctx.wait(1200);
  };
  const cards = () => ctx.run(`[...document.querySelectorAll('.requests .rq-item')].map((c) => ({ title: c.querySelector('.l1').textContent, l2: c.querySelector('.l2').textContent, tag: c.querySelector('.req-status .tag')?.textContent ?? '', more: !c.querySelector('.rq-more').hidden, img: !!c.querySelector('.thumb img, .thumb .fallback-title') }))`);
  const status = () => ctx.run(`document.querySelector('.requests .page-status h3')?.textContent ?? ''`);
  const head = () => ctx.run(`({ scope: document.querySelector('.requests .lib-switch-btn')?.textContent ?? null, seg: [...document.querySelectorAll('.requests .lib-controls .segmented button, .requests .lib-controls .segmented [role=radio]')].map((b) => b.textContent) })`);
  const pickFilter = (label) => ctx.run(`[...document.querySelectorAll('.requests .lib-controls .segmented button, .requests .lib-controls .segmented [role=radio]')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);
  const cardByTitle = (title) => `[...document.querySelectorAll('.requests .rq-item')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)})`;
  const openActions = async (title) => {
    await ctx.run(`${cardByTitle(title)}.querySelector('.rq-more').click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 2000);
    await ctx.wait(200);
    return ctx.run(`[...document.querySelectorAll('.menu .menu-item')].map((b) => ({ t: b.querySelector('.lbl').textContent, danger: b.classList.contains('danger') }))`);
  };
  const pickMenu = (label) => ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.querySelector('.lbl').textContent === ${JSON.stringify(label)})?.click()`);
  // Rueckfrage beantworten; ohne Rueckfrage '' (die Pruefung danach scheitert dann sauber)
  const confirm = async (button) => {
    if (!(await waitFor(`!!document.querySelector('.mdl')`, 3000))) return '';
    const text = await ctx.run(`document.querySelector('.mdl').textContent`);
    await ctx.run(`[...document.querySelectorAll('.mdl .btn')].find((b) => b.textContent.trim() === ${JSON.stringify(button)})?.click()`);
    return text;
  };

  // Eigene: 3 wartende, 2 abgeschlossene; fremde ("ben"): 2 wartende. Jeweils die aeltesten "open" warten.
  await debug('requests?count=2&open=0&by=1'); // 1, 2 abgeschlossen
  await debug('requests?count=3&open=3&by=1'); // 3, 4, 5 warten
  await debug('requests?count=2&open=2&by=3'); // 6, 7 warten (ben)

  // ---------- Normaler Benutzer ----------
  await go('#/requests', `document.querySelectorAll('.requests .rq-item').length === 3`);
  await waitFor(`[...document.querySelectorAll('.requests .rq-item .l1')].every((l) => l.textContent)`, 6000);
  let list = await cards();
  check('Meine Anfragen, offen: die drei eigenen wartenden, neueste zuerst', JSON.stringify(list.map((c) => c.title)) === JSON.stringify(['Anfrage 90005', 'Anfrage 90004', 'Anfrage 90003']), JSON.stringify(list.map((c) => c.title)));
  check('Plakat: Stand als Tag "Angefragt", darunter Jahr und Art, Bild oder Titel auf dem Plakat', list.every((c) => c.tag === 'Angefragt' && c.l2 === '2025 · Film' && c.img), JSON.stringify(list[0]));
  const h0 = await head();
  check('Kopfzeile: keine Wahl "Verwalten" ohne das Recht dazu, Anzeige Offen/Abgeschlossen', h0.scope === null && JSON.stringify(h0.seg) === JSON.stringify(['Offen', 'Abgeschlossen']), JSON.stringify(h0));
  check('Ambient Glow "Anfragen"', await ctx.run(`document.querySelector('#glow')?.dataset.scope === 'requests'`));
  await ctx.capture(path.join(out, 'RQ-01-meine-offen.png'));
  await pickFilter('Abgeschlossen');
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 2`, 4000);
  list = await cards();
  check('Abgeschlossen: die zwei erledigten mit "Verfügbar", ohne Aktionen', list.length === 2 && list.every((c) => c.tag === 'Verfügbar' && !c.more), JSON.stringify(list));
  await pickFilter('Offen');
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 3`, 4000);
  let menu = await openActions('Anfrage 90003');
  check('Eigene wartende: nur "Anfrage zurückziehen" (rot)', JSON.stringify(menu) === JSON.stringify([{ t: 'Anfrage zurückziehen', danger: true }]), JSON.stringify(menu));
  state.log.length = 0;
  await pickMenu('Anfrage zurückziehen');
  const askText = await confirm('Abbrechen');
  check('Zurueckziehen fragt nach und nennt den Titel; Abbrechen aendert nichts', /Anfrage zurückziehen\?/.test(askText) && /„Anfrage 90003“/.test(askText) && !state.log.some((l) => /DELETE/.test(l.at)), askText);
  await openActions('Anfrage 90003');
  await pickMenu('Anfrage zurückziehen');
  await confirm('Zurückziehen');
  check('Zurueckgezogen: die Anfrage ist weg, Seerr bekam genau ein DELETE', (await waitFor(`!${cardByTitle('Anfrage 90003')} && document.querySelectorAll('.requests .rq-item').length === 2`, 5000)) && state.log.filter((l) => l.at === 'seerr:DELETE /request/3').length === 1, JSON.stringify(state.log.map((l) => l.at)));
  // Antippen: der Titel ist nicht in der Mediathek, also seine Seite bei Seerr (im Verlauf, "Zurueck" fuehrt in den Reiter)
  await ctx.run(`${cardByTitle('Anfrage 90005')}.click()`);
  check('Antippen oeffnet den Titel (nicht in der Mediathek: seine Seite bei Seerr)', await waitFor(`location.hash === '#/seerr/movie/90005' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Anfrage 90005'`, 4000), await ctx.run('location.hash'));
  await ctx.run(`history.back()`);
  await waitFor(`location.hash === '#/requests' && document.querySelectorAll('.requests .rq-item').length === 2`, 5000);
  await ctx.run(`(() => { const c = ${cardByTitle('Anfrage 90004')}; c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })); })()`);
  check('Tastatur: die Kontextmenue-Taste auf dem Plakat oeffnet die Aktionen', await waitFor(`!!document.querySelector('.menu.open')`, 2000));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);

  // ---------- Mit "Anfragen verwalten" ----------
  SEERR.permissions = 16 | 32;
  await relogin(); // die Pruefung beim Profilwechsel liest die Rechte neu
  await go('#/home');
  await go('#/requests', `!!document.querySelector('.requests .lib-switch-btn')`);
  check('Mit dem Recht: Wahl "Meine Anfragen" neben der Ueberschrift', (await head()).scope === 'Meine Anfragen', JSON.stringify(await head()));
  await ctx.run(`document.querySelector('.requests .lib-switch-btn').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.wait(200);
  await pickMenu('Verwalten');
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 4 && [...document.querySelectorAll('.requests .rq-item .l1')].every((l) => l.textContent)`, 6000);
  list = await cards();
  check('Verwalten, offen: eigene und fremde wartende, fremde mit "von ben"', list.length === 4 && list.filter((c) => /von ben$/.test(c.l2)).length === 2 && list.filter((c) => /von Demo$/.test(c.l2)).length === 2, JSON.stringify(list.map((c) => c.l2)));
  menu = await openActions('Anfrage 90007');
  check('Fremde wartende: Genehmigen, Ablehnen (rot), abgesetzt Entfernen (rot)', JSON.stringify(menu) === JSON.stringify([{ t: 'Genehmigen', danger: false }, { t: 'Ablehnen', danger: true }, { t: 'Anfrage entfernen', danger: true }]) && (await ctx.run(`document.querySelectorAll('.menu .menu-sep').length === 1`)), JSON.stringify(menu));
  await ctx.capture(path.join(out, 'RQ-02-verwalten-menue.png'));
  await pickMenu('Genehmigen');
  check('Genehmigen ohne Rueckfrage: der Stand wird "In Bearbeitung", die Anfrage bleibt offen', (await waitFor(`${cardByTitle('Anfrage 90007')}?.querySelector('.req-status .tag')?.textContent === 'In Bearbeitung'`, 5000)) && !(await ctx.run(`!!document.querySelector('.mdl')`)));
  await openActions('Anfrage 90006');
  await pickMenu('Ablehnen');
  const declineText = await confirm('Ablehnen');
  check('Ablehnen fragt nach; danach ist die Anfrage abgeschlossen (nicht mehr unter Offen)', /Anfrage ablehnen\?/.test(declineText) && (await waitFor(`!${cardByTitle('Anfrage 90006')}`, 5000)), declineText);
  await openActions('Anfrage 90004');
  await pickMenu('Anfrage entfernen');
  const removeText = await confirm('Entfernen');
  check('Entfernen fragt nach und sagt, dass Titel und Dateien bleiben; danach ist die Anfrage weg', /Anfrage entfernen\?/.test(removeText) && /Dateien bleiben unberührt/.test(removeText) && (await waitFor(`!${cardByTitle('Anfrage 90004')}`, 5000)), removeText);
  await pickFilter('Abgeschlossen');
  await waitFor(`!!${cardByTitle('Anfrage 90006')}`, 4000);
  check('Abgeschlossen: die abgelehnte mit "Abgelehnt"', (await ctx.run(`${cardByTitle('Anfrage 90006')}.querySelector('.req-status .tag').textContent`)) === 'Abgelehnt');
  await pickFilter('Offen');
  await ctx.capture(path.join(out, 'RQ-03-verwalten.png'));
  // Recht entzogen: "Verwalten" schliesst, die eigenen bleiben
  SEERR.permissions = 32;
  await relogin();
  await go('#/requests', `document.querySelectorAll('.requests .rq-item').length > 0`);
  await ctx.wait(800);
  const after = await head();
  list = await cards();
  check('Recht entzogen: keine Wahl mehr, zurueck zu "Meine Anfragen" (keine fremden)', after.scope === null && list.length > 0 && list.every((c) => !/von /.test(c.l2)), JSON.stringify({ after, list: list.map((c) => c.title) }));

  // ---------- Blaettern zu je 50 ----------
  await go('#/home'); // der Reiter merkt sich beim Verlassen, wie viel geladen war: hier eine kurze Liste
  await debug('reset?seerr=1');
  SEERR.permissions = 32;
  await debug('requests?count=120&open=2&by=1'); // die zwei aeltesten warten: sie stehen erst auf der dritten Seite
  state.log.length = 0;
  await go('#/requests', `document.querySelectorAll('.requests .rq-item').length === 2`);
  const pages = () => state.log.filter((l) => l.at === 'seerr:GET /request');
  await waitFor(`[...document.querySelectorAll('.requests .rq-item .l1')].every((l) => l.textContent)`, 6000);
  list = await cards();
  check('Offen hinter 120 abgeschlossenen: der Reiter blaettert von selbst bis zu ihnen (3 Seiten)', JSON.stringify(list.map((c) => c.title)) === JSON.stringify(['Anfrage 90002', 'Anfrage 90001']) && pages().length === 3, `${list.map((c) => c.title)} / ${pages().length} Seiten`);
  await pickFilter('Abgeschlossen');
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 118`, 6000);
  check('Abgeschlossen: alle 118 da, ohne weitere Abfrage (schon geladen)', (await ctx.run(`document.querySelectorAll('.requests .rq-item').length`)) === 118 && pages().length === 3);
  state.log.length = 0;
  await ctx.run(`document.querySelector('.toolpill .tool').click()`); // Neu laden
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 118`, 8000);
  await ctx.wait(600);
  check('Neu laden holt in einem Abruf so viel, wie da war (120), und bleibt bei "Abgeschlossen"', pages().length === 1 && (await ctx.run(`document.querySelector('.requests .lib-controls .segmented [aria-checked=true], .requests .lib-controls .segmented .on')?.textContent`)) === 'Abgeschlossen', JSON.stringify(pages().length));
  await ctx.capture(path.join(out, 'RQ-04-blaettern.png'));

  // ---------- Kompaktansicht (Handy) ----------
  // Das Desktop-Programm wird nie kompakt (Mindestbreite), und im Browser-Test kann Seerr kein Cookie lesen: hier nur die Regel selbst, der
  // Aktionsknopf steht ohne Zeigen da (auf dem Handy gibt es kein Zeigen)
  await pickFilter('Offen');
  await waitFor(`document.querySelectorAll('.requests .rq-item').length === 2`, 4000);
  await ctx.run(`document.activeElement?.blur()`);
  // Ohne Uebergang messen (sonst stuende der Wert noch am Anfang der Blende)
  const moreOpacity = (compact) => ctx.run(`(() => { const html = document.documentElement; const b = document.querySelector('.requests .rq-item .rq-more'); b.style.setProperty('transition', 'none'); const was = html.dataset.compact; if (${compact}) html.dataset.compact = 'on'; else delete html.dataset.compact; const o = getComputedStyle(b).opacity; if (was) html.dataset.compact = was; else delete html.dataset.compact; b.style.removeProperty('transition'); return o; })()`);
  const op = [await moreOpacity(false), await moreOpacity(true)];
  check('Aktionsknopf: am Desktop erst beim Zeigen, in der Kompaktansicht immer sichtbar', op[0] === '0' && op[1] === '1', JSON.stringify(op));

  // ---------- Fehler beim Laden ----------
  SEERR.mode = 'down';
  await go('#/home');
  await go('#/requests', `/nicht erreichbar/.test(document.querySelector('.requests .page-status h3')?.textContent ?? '')`);
  check('Seerr aus: der Reiter zeigt "Seerr ist nicht erreichbar" mit "Erneut versuchen"', (await status()) === 'Seerr ist nicht erreichbar' && (await ctx.run(`document.querySelector('.requests .ps-action .btn')?.textContent === 'Erneut versuchen'`)), await status());
  SEERR.mode = 'ok';
  await ctx.run(`document.querySelector('.requests .ps-action .btn').click()`);
  check('...nach "Erneut versuchen" wieder die Anfragen', await waitFor(`document.querySelectorAll('.requests .rq-item').length > 0`, 8000));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
