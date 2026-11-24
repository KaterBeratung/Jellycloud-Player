// Gemeldete Probleme ansehen und verwalten (Apple-App Build 94), mit dem Mock-Server auf eigenem Port:
//  - Einstieg im Reiter Anfragen nur mit einem der Rechte; Liste Offen/Gelöst wie die Mitteilungen (Titel, Art, Stand, wer wann)
//  - Meldung als Gespraech: Beschreibung zuerst, Antwort senden (eigene rechts), Als gelöst markieren / Wieder öffnen (Zeile am Ende), löschen mit Rueckfrage
//  - ohne Recht zum Verwalten: der Meldende darf antworten; fremde Meldungen nur lesen (kein Antwortfeld, kein Menue)
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/issues-manage.js
const path = require('node:path');
const { server, SEERR } = require('../mock-server');

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
  const PORT = 8963;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const waitFor = async (js, ms = 9000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  // Zwei Meldungen: eine von "ben" (3) zu Mock Arrival (Seerr-Nummer 42), Video; eine von Demo (1) zu Mock Thrones (13), Ton, Staffel 2 Folge 5
  SEERR.issues.push(
    { id: 1, issueType: 1, status: 1, message: 'Bild ruckelt ab Minute 40.', media: { id: 42 }, createdBy: 3, createdAt: '2026-11-20T09:00:00.000Z', updatedAt: '2026-11-20T09:00:00.000Z' },
    { id: 2, issueType: 2, status: 1, problemSeason: 2, problemEpisode: 5, message: 'Ton fehlt.', media: { id: 13 }, createdBy: 1, createdAt: '2026-11-19T09:00:00.000Z', updatedAt: '2026-11-19T09:00:00.000Z' }
  );
  ctx.win.setContentSize(1280, 860);
  SEERR.permissions = 32; // nur anfragen: kein Einstieg
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/requests'`);
  await waitFor(`!!document.querySelector('.requests .lib-controls .segmented')`, 9000);
  check('Ohne Recht fuer Probleme: kein Einstieg', !(await ctx.run(`!!document.querySelector('[data-action="issues"]')`)));

  SEERR.permissions = 32 | 1048576; // anfragen und Probleme verwalten
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/requests'`);
  check('Mit Recht: Knopf "Gemeldete Probleme" im Reiter Anfragen', await waitFor(`document.querySelector('[data-action="issues"]')?.textContent === 'Gemeldete Probleme'`, 9000));
  await ctx.run(`document.querySelector('[data-action="issues"]').click()`);
  await waitFor(`location.hash === '#/issues' && document.querySelectorAll('.issues-page .issue-row').length === 2`, 9000);
  await waitFor(`![...document.querySelectorAll('.issues-page .issue-row .notice-title')].some((x) => x.textContent === '…')`, 6000);
  const rows = await ctx.run(`[...document.querySelectorAll('.issues-page .issue-row')].map((r) => ({ title: r.querySelector('.notice-title').textContent, msg: r.querySelector('.notice-message').textContent, tag: r.querySelector('.tag')?.textContent, meta: r.querySelector('.notice-meta span:last-child')?.textContent }))`);
  check('Liste: zuletzt geaenderte zuerst; Titel, Art (mit Staffel/Folge), Stand, wer wann', JSON.stringify(rows.map((r) => r.title)) === JSON.stringify(['Mock Arrival', 'Mock Thrones']) && rows[0].msg === 'Video' && rows[1].msg === 'Audio · Staffel 2, Folge 5' && rows.every((r) => r.tag === 'Offen') && /^Gemeldet von ben am/.test(rows[0].meta) && /^Gemeldet von dir am/.test(rows[1].meta), JSON.stringify(rows));
  await ctx.capture(path.join(out, 'IM-list.png'));

  // ---------- Meldung ----------
  await ctx.run(`document.querySelector('.issues-page .issue-row[data-id="1"]').click()`);
  await waitFor(`location.hash === '#/issues/1' && document.querySelectorAll('.issue-thread .issue-msg').length === 1`, 9000);
  const first = await ctx.run(`({ text: document.querySelector('.issue-thread .issue-bubble').textContent, own: document.querySelector('.issue-thread .issue-msg').classList.contains('own'), reply: !document.querySelector('.issue-reply').hidden, more: !document.querySelector('.notices-more').hidden, send: document.querySelector('.issue-send').disabled })`);
  check('Meldung: Beschreibung als erster Beitrag (fremd, links), Antwortfeld und Menue (Verwalter), Senden erst mit Text', first.text === 'Bild ruckelt ab Minute 40.' && !first.own && first.reply && first.more && first.send, JSON.stringify(first));
  await ctx.run(`(() => { const f = document.querySelector('.issue-reply-field'); f.value = 'Danke, schaue ich mir an.'; f.dispatchEvent(new Event('input')); document.querySelector('.issue-send').click(); })()`);
  await waitFor(`document.querySelectorAll('.issue-thread .issue-msg').length === 2`, 8000);
  const after = await ctx.run(`({ last: document.querySelector('.issue-thread .issue-msg:last-of-type .issue-bubble')?.textContent, own: document.querySelector('.issue-thread .issue-msg:last-of-type')?.classList.contains('own'), field: document.querySelector('.issue-reply-field').value })`);
  check('Antwort gesendet: steht rechts als eigener Beitrag, Feld leer', after.last === 'Danke, schaue ich mir an.' && after.own && after.field === '', JSON.stringify(after));
  await ctx.capture(path.join(out, 'IM-thread.png'));
  await ctx.run(`document.querySelector('.notices-more').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  const menu = await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].map((b) => b.querySelector('.lbl')?.textContent ?? b.textContent)`);
  check('Menue: Als gelöst markieren, Meldung löschen', JSON.stringify(menu) === JSON.stringify(['Als gelöst markieren', 'Meldung löschen']), JSON.stringify(menu));
  await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')][0].click()`);
  await waitFor(`!!document.querySelector('.issue-note')`, 8000);
  const resolved = await ctx.run(`({ note: document.querySelector('.issue-note')?.textContent, tag: document.querySelector('.issue-head .tag')?.textContent })`);
  check('Gelöst: Zeile "Als gelöst markiert" am Ende, Stand "Gelöst"', /^Als gelöst markiert · /.test(resolved.note ?? '') && resolved.tag === 'Gelöst' && SEERR.issues[0].status === 2, JSON.stringify(resolved));
  await ctx.wait(400); // das vorige Menue ist ganz zu
  await ctx.run(`document.querySelector('.notices-more').click()`);
  await waitFor(`[...document.querySelectorAll('.menu.open .menu-item')].some((b) => (b.querySelector('.lbl')?.textContent ?? b.textContent) === 'Wieder öffnen')`, 3000);
  const menu2 = await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].map((b) => b.querySelector('.lbl')?.textContent ?? b.textContent)`);
  check('Menue danach: "Wieder öffnen"', menu2.includes('Wieder öffnen'), JSON.stringify(menu2));
  await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].find((b) => (b.querySelector('.lbl')?.textContent ?? b.textContent) === 'Meldung löschen').click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .btn.danger')`, 3000);
  check('Löschen mit roter Rueckfrage', await ctx.run(`document.querySelector('.mdl-scrim .mdl-title').textContent === 'Meldung löschen?'`));
  await ctx.run(`document.querySelector('.mdl-scrim .btn.danger').click()`);
  await waitFor(`location.hash === '#/issues'`, 6000);
  await ctx.wait(800);
  check('Geloescht: zurueck zur Liste, Meldung weg', SEERR.issues[0].deleted === true && (await ctx.run(`![...document.querySelectorAll('.issues-page .issue-row')].some((r) => r.dataset.id === '1')`)));

  // ---------- Ohne Verwalten: eigene beantworten, fremde nur lesen ----------
  SEERR.permissions = 32 | 4194304 | 2097152; // anfragen, melden, ansehen
  SEERR.issues.push({ id: 3, issueType: 4, status: 1, message: 'Falsche Sprache.', media: { id: 42 }, createdBy: 3, createdAt: '2026-11-21T09:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z' });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/issues/3'`);
  await waitFor(`document.querySelectorAll('.issue-thread .issue-msg').length === 1`, 8000);
  check('Fremde Meldung ohne Verwalten: nur lesen', await ctx.run(`document.querySelector('.issue-reply').hidden && document.querySelector('.notices-more').hidden`));
  await ctx.run(`location.hash = '#/issues/2'`);
  await waitFor(`document.querySelectorAll('.issue-thread .issue-msg').length === 1 && document.querySelector('.issue-thread .issue-bubble').textContent === 'Ton fehlt.'`, 8000);
  check('Eigene Meldung: antworten und Menue', await ctx.run(`!document.querySelector('.issue-reply').hidden && !document.querySelector('.notices-more').hidden && document.querySelector('.issue-thread .issue-msg').classList.contains('own')`));

  check('Keine Fehler in der Konsole', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
