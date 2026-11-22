// Seerr je Profil und vier Zustaende (P10, nach SeerrSection und RequestsView der Apple-App), mit dem Mock-Server auf Port 8993:
//  - Einstellungen > Seerr: Stand mit Symbol und Hinweis, Adresse, "Jellyfin-Konto (Name)", "Erneut pruefen", "Trennen" mit Rueckfrage
//  - Reiter Anfragen: verbunden, nicht erreichbar ("Erneut versuchen"), Anmeldung abgelaufen ("Erneut anmelden"); ein Ausfall loescht nichts
//  - fremde Sitzung: meldet Seerr ein anderes Konto, wird die Sitzung abgemeldet und verworfen, "Erneut anmelden"
//  - zwei Profile, zwei Seerr-Benutzer (eines mit einem anderen Jellyfin-Konto): der Wechsel stellt jeweils die eigene Sitzung her
//  - Sprache der Seerr-Texte (language=de an Suche und Trends, nicht an Anmeldung und Rechte)
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr-states.js
const path = require('node:path');
const http = require('node:http');
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
  const PORT = 8993;
  const PORT2 = 8992; // derselbe Testserver unter einer zweiten Adresse: ein zweites Profil
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const second = http.createServer((req, res) => server.emit('request', req, res));
  await new Promise((resolve, reject) => {
    second.once('error', reject);
    second.listen(PORT2, '127.0.0.1', resolve);
  });
  const SEERR_URL = `http://127.0.0.1:${PORT}`;

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
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
  const type = (sel, value) => ctx.run(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clickText = (sel, text) => ctx.run(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.innerText.includes(${JSON.stringify(text)}))?.click() ?? 'nicht gefunden'`);
  const panelText = () => ctx.run(`document.querySelector('.settings-panel')?.innerText ?? ''`);
  const stateOf = () => ctx.run(`document.querySelector('.settings-panel .status-row')?.dataset.state ?? ''`);
  const reqStatus = () => ctx.run(`(() => { const st = document.querySelector('.requests .page-status'); return { kind: st?.dataset.kind ?? '', title: st?.querySelector('h3')?.textContent ?? '', btn: st?.querySelector('.ps-action .btn')?.textContent ?? '', href: st?.querySelector('.ps-action .btn')?.getAttribute('href') ?? null }; })()`);
  const seerrNow = () => ctx.run(`window.jc.seerrCheck().then((r) => r.seerr)`);
  const toHome = () => go('#/home', `!!document.querySelector('.home .rows .row:not(.skeleton)')`);

  // ---------- Verbinden in den Einstellungen ----------
  await go('#/settings/seerr', `!!document.querySelector('.settings-panel input.field')`);
  check('Nicht eingerichtet: Adresse, Jellyfin-Konto (vorbelegt "demo") und Jellyfin-Passwort, kein Stand', (await ctx.run(`document.querySelector('.settings-panel input[autocomplete=username]').value === 'demo' && !document.querySelector('.settings-panel .status-row')`)));
  await type('.settings-panel input[inputmode=url]', `127.0.0.1:${PORT}`);
  await type('.settings-panel input[type=password]', 'demo');
  state.log.length = 0;
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Verbunden: Stand "Verbunden" mit gruenem Haken, Adresse, "Jellyfin-Konto (demo)", "Erneut pruefen", "Trennen"', await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`, 6000) && /Jellyfin-Konto \(demo\)/.test(await panelText()) && (await panelText()).includes(SEERR_URL) && /Erneut prüfen/.test(await panelText()) && /Trennen/.test(await panelText()), await panelText());
  check('...kein Rest einer leeren Stelle im Text (etwa "null")', !/\bnull\b|undefined/.test(await panelText()), await panelText());
  check('Die Anmeldung fragt Seerr nach dem Konto (/auth/me), ohne Sprache; das Passwort steht nicht mehr im Feld', state.log.some((l) => l.at === 'seerr:GET /auth/me' && !l.language) && (await ctx.run(`!document.querySelector('.settings-panel input[type=password]')`)));
  const ok = await ctx.run(`(() => { const s = document.querySelector('.settings-panel .status-row'); return getComputedStyle(s.querySelector('.ico')).color; })()`);
  check('Der Haken ist gruen wie die Schalter', ok === (await ctx.run(`getComputedStyle(document.documentElement).getPropertyValue('--switch-on').trim()`)) || /rgb\(48, 209, 88\)|rgb\(52, 199, 89\)/.test(ok), ok);
  await ctx.capture(path.join(out, 'SS-01-verbunden.png'));

  // ---------- Reiter Anfragen: verbunden ----------
  await go('#/requests', `!!document.querySelector('.requests .page-status h3')`);
  let rq = await reqStatus();
  check('Anfragen verbunden (noch keine): "Keine offenen Anfragen", kein Hinweis zum Verbinden', rq.title === 'Keine offenen Anfragen' && !rq.btn, JSON.stringify(rq));

  // ---------- Sprache ----------
  state.log.length = 0;
  await go('#/search?q=mock', `!document.querySelector('.search-results.busy')`);
  await waitFor(`!!document.querySelector('.seerr-group')`, 6000);
  const langs = state.log.filter((l) => l.at === 'seerr:GET /search').map((l) => l.language);
  check('Suche bei Seerr mit language=de (Sprache der App)', langs.length >= 1 && langs.every((v) => v === 'de'), JSON.stringify(langs));

  // ---------- Seerr nicht erreichbar ----------
  SEERR.mode = 'down';
  await go('#/requests', `document.querySelector('.requests .page-status h3')?.textContent === 'Seerr ist nicht erreichbar'`);
  rq = await reqStatus();
  check('Seerr aus: Anfragen zeigt "Seerr ist nicht erreichbar" mit "Erneut versuchen"', rq.kind === 'failed' && rq.title === 'Seerr ist nicht erreichbar' && rq.btn === 'Erneut versuchen', JSON.stringify(rq));
  await ctx.capture(path.join(out, 'SS-02-nicht-erreichbar.png'));
  check('...die Einrichtung bleibt (Adresse und Sitzung gespeichert)', ctx.config.getSeerr()?.secret === SEERR.sid);
  await toHome();
  check('...Jellyfin laeuft unberuehrt weiter (Startseite mit Reihen, keine Anmeldung)', await ctx.run(`!!document.querySelector('.home .rows .row') && !document.querySelector('.login')`));
  await go('#/settings/seerr', `document.querySelector('.settings-panel .status-row')?.dataset.state === 'unreachable'`);
  check('Einstellungen: "Seerr ist nicht erreichbar" mit Hinweis, "Erneut pruefen" bleibt', (await stateOf()) === 'unreachable' && /Seerr ist nicht erreichbar/.test(await panelText()) && /Prüfe, ob Seerr läuft/.test(await panelText()) && /Erneut prüfen/.test(await panelText()), await panelText());
  SEERR.mode = 'ok';
  await clickText('.settings-panel .link-row', 'Erneut prüfen');
  check('Seerr wieder da, "Erneut pruefen": verbunden', await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`, 6000));
  SEERR.mode = 'down';
  await go('#/requests', `document.querySelector('.requests .page-status h3')?.textContent === 'Seerr ist nicht erreichbar'`);
  SEERR.mode = 'ok';
  await clickText('.requests .ps-action .btn', 'Erneut versuchen');
  check('Anfragen: "Erneut versuchen" nach der Rueckkehr von Seerr zeigt wieder den verbundenen Stand', await waitFor(`document.querySelector('.requests .page-status h3')?.textContent === 'Keine offenen Anfragen'`, 6000), JSON.stringify(await reqStatus()));

  // ---------- Anmeldung abgelaufen ----------
  SEERR.sid = `mock-seerr-sid-${Date.now().toString(36)}`; // wie /__debug/mode?set=expired: alle bisherigen Sitzungen ungueltig
  await toHome(); // der Reiter Anfragen ist schon offen: erst weg, dann neu oeffnen
  await go('#/requests', `document.querySelector('.requests .page-status h3')?.textContent === 'Seerr-Anmeldung abgelaufen'`);
  rq = await reqStatus();
  check('Sitzung abgelaufen: Anfragen zeigt "Seerr-Anmeldung abgelaufen" mit "Erneut anmelden" (fuehrt in die Einstellungen)', rq.title === 'Seerr-Anmeldung abgelaufen' && rq.btn === 'Erneut anmelden' && rq.href === '#/settings/seerr', JSON.stringify(rq));
  await ctx.capture(path.join(out, 'SS-03-abgelaufen.png'));
  await ctx.run(`document.querySelector('.requests .ps-action .btn').click()`);
  await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'unauthorized'`, 6000);
  const expired = await ctx.run(`(() => { const p = document.querySelector('.settings-panel'); return { text: p.innerText, account: p.querySelector('input[autocomplete=username]')?.value, btn: [...p.querySelectorAll('.btn.primary')].map((b) => ({ t: b.innerText, off: b.disabled })), recheck: [...p.querySelectorAll('.link-row')].some((r) => /Erneut prüfen/.test(r.innerText)) }; })()`);
  check('Einstellungen: "Anmeldung nicht mehr gueltig", Abschnitt "Anmeldung abgelaufen" mit Konto (vorbelegt) und Passwort, ohne "Erneut pruefen"', /Anmeldung nicht mehr gültig/.test(expired.text) && /Anmeldung abgelaufen/i.test(expired.text) && expired.account === 'demo' && expired.btn.length === 1 && expired.btn[0].t === 'Erneut anmelden' && expired.btn[0].off && !expired.recheck, JSON.stringify(expired));
  check('...Jellyfin bleibt angemeldet', await ctx.run(`!document.querySelector('.login')`));
  await ctx.capture(path.join(out, 'SS-04-erneut-anmelden.png'));
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel .btn.primary', 'Erneut anmelden');
  check('Erneut angemeldet mit dem Passwort: verbunden', await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`, 6000), await panelText());

  // ---------- Fremde Sitzung ----------
  const logoutsBefore = SEERR.counters.logouts;
  SEERR.identity = 'fremdes-konto-0001';
  // Die naechste Pruefung (hier "Erneut pruefen"; sonst Start, Profilwechsel, Rueckkehr in die App) bemerkt das andere Konto
  await clickText('.settings-panel .link-row', 'Erneut prüfen');
  await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'unauthorized'`, 6000);
  await go('#/requests', `document.querySelector('.requests .page-status h3')?.textContent === 'Seerr-Anmeldung abgelaufen'`);
  check('Seerr meldet ein anderes Konto: Anfragen zeigt "Erneut anmelden"', (await reqStatus()).btn === 'Erneut anmelden', JSON.stringify(await reqStatus()));
  await ctx.wait(300); // die Abmeldung bei Seerr laeuft im Hintergrund
  check('...die fremde Sitzung ist bei Seerr abgemeldet und verworfen, Adresse und Konto bleiben', SEERR.counters.logouts === logoutsBefore + 1 && ctx.config.getSeerr()?.secret === '' && ctx.config.getSeerr()?.url === SEERR_URL && ctx.config.getSeerr()?.userName === 'demo', JSON.stringify({ logouts: SEERR.counters.logouts - logoutsBefore, url: ctx.config.getSeerr()?.url }));
  const sessionsBefore = SEERR.counters.sessionRequests;
  await go('#/search?q=mock', `!document.querySelector('.search-results.busy')`);
  await ctx.wait(800);
  check('...ohne Sitzung geht nichts mehr an Seerr (die Suche sagt "abgelaufen")', SEERR.counters.sessionRequests === sessionsBefore && (await ctx.run(`/abgelaufen/.test(document.querySelector('.seerr-note')?.textContent ?? '')`)));
  await go('#/settings/seerr', `document.querySelector('.settings-panel .status-row')?.dataset.state === 'unauthorized'`);
  check('Einstellungen nennen den Grund (anderes Konto gemeldet)', /ein anderes Konto gemeldet/.test(await panelText()), await panelText());
  SEERR.identity = null;
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel .btn.primary', 'Erneut anmelden');
  check('Erneut angemeldet: verbunden', await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`, 6000));

  // ---------- Trennen mit Rueckfrage ----------
  await clickText('.settings-panel .link-row.danger', 'Trennen');
  check('Trennen fragt nach', await waitFor(`/Seerr trennen\\?/.test(document.querySelector('.mdl')?.textContent ?? '')`, 3000));
  await clickText('.mdl .btn', 'Abbrechen');
  await ctx.wait(500);
  check('Abbrechen laesst Seerr verbunden', ctx.config.getSeerr()?.secret === SEERR.sid && (await stateOf()) === 'connected');

  // ---------- Zweites Profil mit einem anderen Jellyfin-Konto bei Seerr ----------
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT2}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.home')`, 8000);
  await ctx.wait(1200);
  const profiles = await ctx.run(`window.jc.getState().then((s) => ({ ids: s.servers.map((x) => x.id), active: s.activeServerId, seerr: s.seerr }))`);
  check('Zweites Profil angemeldet, ohne Seerr', profiles.ids.length === 2 && profiles.seerr === null, JSON.stringify(profiles));
  await go('#/requests', `!!document.querySelector('.requests .page-status h3')`);
  check('...Anfragen dort: "Seerr nicht verbunden"', (await reqStatus()).title === 'Seerr nicht verbunden', JSON.stringify(await reqStatus()));
  await go('#/settings/seerr', `!!document.querySelector('.settings-panel input[autocomplete=username]')`);
  check('...die Adresse ist aus der letzten Verbindung vorbelegt, das Konto mit dem des Profils', await ctx.run(`document.querySelector('.settings-panel input[inputmode=url]').value === ${JSON.stringify(SEERR_URL)} && document.querySelector('.settings-panel input[autocomplete=username]').value === 'demo'`));
  await type('.settings-panel input[autocomplete=username]', 'demo2');
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Mit einem anderen Jellyfin-Konto angemeldet: verbunden, die Einstellungen nennen dieses Konto', await waitFor(`document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`, 6000) && /Jellyfin-Konto \(demo2\)/.test(await panelText()), await panelText());
  const b = await seerrNow();
  check('...eine spaetere Pruefung laesst es verbunden (keine fremde Sitzung), Seerr-Benutzer "Demo Zwei"', b.state === 'connected' && b.user?.displayName === 'Demo Zwei' && b.user?.id === 2, JSON.stringify(b));

  // ---------- Wechsel zwischen den Profilen ----------
  const switchTo = async (port) => {
    await ctx.run(`document.querySelector('.toolpill .who').click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 2000);
    await ctx.wait(250);
    await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => (b.querySelector('.sub')?.textContent ?? '').endsWith(':${port}'))?.click()`);
    await waitFor(`!!document.querySelector('.home')`, 8000);
    await ctx.wait(1200);
  };
  await switchTo(PORT);
  const a = await seerrNow();
  check('Wechsel zum ersten Profil: seine eigene Sitzung (Seerr-Benutzer "Demo")', a.state === 'connected' && a.user?.displayName === 'Demo' && a.user?.id === 1, JSON.stringify(a));
  await go('#/settings/seerr', `document.querySelector('.settings-panel .status-row')?.dataset.state === 'connected'`);
  check('...die Einstellungen zeigen "Jellyfin-Konto (demo)"', /Jellyfin-Konto \(demo\)/.test(await panelText()));
  await switchTo(PORT2);
  const b2 = await seerrNow();
  check('Zurueck zum zweiten Profil: wieder "Demo Zwei"', b2.user?.displayName === 'Demo Zwei', JSON.stringify(b2));
  state.log.length = 0;
  await toHome();
  await ctx.wait(1500);
  const trendLangs = state.log.filter((l) => l.at === 'seerr:GET /discover/trending').map((l) => l.language);
  check('Trends der Startseite mit language=de', trendLangs.length >= 1 && trendLangs.every((v) => v === 'de'), JSON.stringify(trendLangs));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  second.close();
  server.close();
  if (fail) process.exitCode = 1;
};
