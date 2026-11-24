// Anfragen verwalten wie die Apple-App Build 94/95, mit dem Mock-Server auf eigenem Port:
//  - Menue einer Anfrage: Einzelheiten als Kopf (wer, wann, wer entschieden hat), dann die Aktionen
//  - "Staffeln ändern": Auswahl mit den Staffeln der Anfrage, Speichern erst nach einer Aenderung, Seerr bekommt die neuen Staffeln
//  - "Anfrage ändern": Zielserver, Profil, Ordner, "Anfragen als"; Seerr bekommt den ganzen Stand
//  - "Als verfügbar markieren": nach einer Rueckfrage, danach "Verfügbar"
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/requests-manage.js
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
  const PORT = 8962;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' }).then((r) => r.json());
  const waitFor = async (js, ms = 9000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  ctx.win.setContentSize(1280, 860);
  SEERR.permissions = 16 | 32 | 8; // verwalten, anfragen, Benutzer verwalten
  await debug('requests?count=2&open=2&by=3&type=tv'); // zwei wartende Serienanfragen von "ben" (Staffel 1)
  await debug('requests?count=1&open=0&by=3&status=2'); // eine genehmigte Filmanfrage
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/requests'`);
  await waitFor(`!!document.querySelector('.requests .lib-switch-btn')`, 9000);
  await ctx.run(`document.querySelector('.requests .lib-switch-btn').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Verwalten'))?.click()`);
  await waitFor(`document.querySelectorAll('.requests .rq-item').length >= 2 && ![...document.querySelectorAll('.requests .rq-item .l1')].some((x) => x.classList.contains('sk'))`, 9000);
  await ctx.wait(500);

  const cardSel = (title) => `[...document.querySelectorAll('.requests .rq-item')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)})`;
  const openMenuOf = async (title) => {
    await ctx.run(`(${cardSel(title)}).querySelector('.rq-more').click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 3000);
    return ctx.run(`({ heads: [...document.querySelectorAll('.menu.open .menu-head')].map((x) => x.textContent), items: [...document.querySelectorAll('.menu.open .menu-item')].map((b) => b.querySelector('.lbl')?.textContent ?? b.textContent) })`);
  };
  const pick = (label) => ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].find((b) => (b.querySelector('.lbl')?.textContent ?? b.textContent) === ${JSON.stringify(label)})?.click()`);

  // ---------- Menue mit Einzelheiten ----------
  const m1 = await openMenuOf('Anfrage 90001');
  check('Kopf des Menues: "Angefragt von ben am ..."', m1.heads.length === 1 && /^Angefragt von ben am \d+\. November 2026$/.test(m1.heads[0]), JSON.stringify(m1.heads));
  check('Ausstehende Serie (Verwalter): Genehmigen, Ablehnen, Staffeln ändern, Anfrage ändern, Entfernen', JSON.stringify(m1.items) === JSON.stringify(['Genehmigen', 'Ablehnen', 'Staffeln ändern', 'Anfrage ändern', 'Anfrage entfernen']), JSON.stringify(m1.items));
  await ctx.wait(350);
  await ctx.capture(path.join(out, 'RM-menu.png'));

  // ---------- Staffeln aendern ----------
  await pick('Staffeln ändern');
  await waitFor(`!!document.querySelector('.mdl-scrim .season-chooser')`, 6000);
  const s0 = await ctx.run(`({ title: document.querySelector('.mdl-scrim .mdl-title').textContent, save: document.querySelector('.mdl-scrim .mdl-actions button:last-child').textContent, disabled: document.querySelector('.mdl-scrim .mdl-actions button:last-child').disabled, on: [...document.querySelectorAll('.mdl-scrim .season-pick')].map((r) => r.querySelector('.switch').getAttribute('aria-checked') ?? String(r.querySelector('.switch').classList.contains('on'))) })`);
  check('Auswahl "Staffeln ändern": Staffel 1 der Anfrage vorgewaehlt, Speichern erst nach einer Aenderung', s0.title === 'Staffeln ändern' && s0.save === 'Speichern' && s0.disabled === true, JSON.stringify(s0));
  await ctx.wait(600);
  await ctx.capture(path.join(out, 'RM-seasons.png'));
  await ctx.run(`document.querySelectorAll('.mdl-scrim .season-pick .switch')[1].click()`);
  await ctx.wait(150);
  check('Staffel 2 dazu: Speichern frei', !(await ctx.run(`document.querySelector('.mdl-scrim .mdl-actions button:last-child').disabled`)));
  await ctx.run(`document.querySelector('.mdl-scrim .mdl-actions button:last-child').click()`);
  await waitFor(`!!SEERR_EDIT`.replace('SEERR_EDIT', 'document.querySelector(".toast")'), 6000);
  await ctx.wait(400);
  check('Seerr bekommt die neuen Staffeln', JSON.stringify(SEERR.lastRequestEdit) === JSON.stringify({ id: 1, body: { mediaType: 'tv', seasons: [1, 2] } }), JSON.stringify(SEERR.lastRequestEdit));
  await waitFor(`/Staffeln 1–2|Staffeln 1, 2/.test((${cardSel('Anfrage 90001')})?.querySelector('.l2').textContent ?? '')`, 6000);
  check('Plakat zeigt danach beide Staffeln', await ctx.run(`/Staffeln 1–2|Staffeln 1, 2/.test((${cardSel('Anfrage 90001')}).querySelector('.l2').textContent)`));

  // ---------- Anfrage aendern ----------
  await openMenuOf('Anfrage 90002');
  await pick('Anfrage ändern');
  await waitFor(`!!document.querySelector('.mdl-scrim .request-editor')`, 6000);
  await waitFor(`[...document.querySelectorAll('.mdl-scrim .request-editor .setting')].length === 4`, 4000);
  const rows = await ctx.run(`[...document.querySelectorAll('.mdl-scrim .request-editor .setting')].map((r) => [r.querySelector('.setting-label').textContent, r.querySelector('.select').textContent])`);
  check('Blatt "Anfrage ändern": Zielserver, Qualitätsprofil, Stammordner, Anfragen als', JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(['Zielserver', 'Qualitätsprofil', 'Stammordner', 'Anfragen als']) && rows[3][1] === 'ben', JSON.stringify(rows));
  await ctx.wait(600); // das Blatt ist ganz eingeblendet
  await ctx.capture(path.join(out, 'RM-edit.png'));
  await ctx.run(`document.querySelectorAll('.mdl-scrim .request-editor .select')[1].click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  await pick('Ultra-HD');
  await ctx.wait(200);
  await ctx.run(`document.querySelectorAll('.mdl-scrim .request-editor .select')[3].click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  await pick('Demo Zwei');
  await ctx.wait(200);
  await ctx.run(`document.querySelector('.mdl-scrim .mdl-actions button:last-child').click()`);
  await waitFor(`!document.querySelector('.mdl-scrim')`, 4000);
  await ctx.wait(800);
  const body = SEERR.lastRequestEdit?.body ?? {};
  check('Seerr bekommt den ganzen Stand: Profil 6, Staffeln, Sprachprofil, neuer Anfragender', SEERR.lastRequestEdit?.id === 2 && body.profileId === 6 && JSON.stringify(body.seasons) === '[1]' && body.languageProfileId === 1 && body.userId === 2 && 'serverId' in body && 'rootFolder' in body, JSON.stringify(SEERR.lastRequestEdit));

  // ---------- Als verfuegbar markieren ----------
  await ctx.run(`[...document.querySelectorAll('.requests .lib-controls .segmented button, .requests .lib-controls .segmented [role=radio]')].find((b) => b.textContent === 'Offen')?.click()`);
  await ctx.wait(600);
  const m3 = await openMenuOf('Anfrage 90003');
  check('Genehmigte Anfrage, Titel noch nicht da: "Als verfügbar markieren"', m3.items.includes('Als verfügbar markieren'), JSON.stringify(m3.items));
  await pick('Als verfügbar markieren');
  await waitFor(`!!document.querySelector('.mdl-scrim .mdl-title')`, 3000);
  const conf = await ctx.run(`({ title: document.querySelector('.mdl-scrim .mdl-title').textContent, danger: !!document.querySelector('.mdl-scrim .btn.danger') })`);
  check('Rueckfrage vor dem Markieren (nicht rot)', conf.title === 'Als verfügbar markieren?' && !conf.danger, JSON.stringify(conf));
  await ctx.run(`[...document.querySelectorAll('.mdl-scrim .mdl-actions button')].find((b) => b.textContent === 'Markieren').click()`);
  await waitFor(`(SEERR_DONE)`.replace('SEERR_DONE', 'true'), 100);
  await ctx.wait(1200);
  check('Seerr hat den Titel als verfuegbar gesetzt', (SEERR.markedAvailable ?? []).length === 1, JSON.stringify(SEERR.markedAvailable));

  check('Keine Fehler in der Konsole', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
