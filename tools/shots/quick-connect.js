// Konto, Profile, Verbindungspruefung und Quick Connect (P8, nach Features/Connect und SettingsView+Account der Apple-App), mit dem Mock-Server auf Port 8995:
//  - Anmeldung wie die Apple-App: Marke, Kapselfelder, "Anmelden" erst mit Adresse und Benutzer, Fehler markieren das Feld; Quick Connect in der Karte mit Ziffernkacheln
//  - Einstellungen > Konto: Server, Benutzer, Adresse, Verbindung; Profile mit Bearbeiten (Name, Adresse desselben Servers, ein fremder Server wird abgelehnt), Entfernen mit Rueckfrage
//  - Maske Quick Connect: ueber der ganzen App (darunter verdeckt und gesperrt), als wer und wo, falscher Code, Erfolg, schon bestaetigt, ausgeschaltet; der Code steht nirgends
//  - Start ohne Server: "Server nicht erreichbar" mit "Erneut versuchen" statt der Anmeldung, nichts geloescht; Rueckkehr in die App prueft die Verbindung
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/quick-connect.js
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { server, state } = require('../mock-server');

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
  const PORT = 8995;
  const BASE = `http://127.0.0.1:${PORT}`;
  // Verbindungen merken: zum Abschalten des Servers muessen auch offene (keep-alive) Verbindungen weg
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  const stop = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      for (const s of sockets) s.destroy();
    });
  await listen();
  // Ein anderer Jellyfin-Server (eigene Kennung) fuer "Adresse eines fremden Servers"
  const other = http.createServer((req, res) => {
    res.writeHead(req.url.startsWith('/System/Info/Public') ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Id: 'anderer-server', ServerName: 'Fremd', Version: '10.10.3' }));
  });
  await new Promise((r) => other.listen(PORT + 100, '127.0.0.1', r));
  const post = (p) => new Promise((resolve) => http.request(`${BASE}${p}`, { method: 'POST' }, (r) => { r.resume(); r.on('end', resolve); }).end());

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(600);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const type = (sel, value) => ctx.run(`(() => { const f = document.querySelector(${JSON.stringify(sel)}); f.focus(); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = (sel) => ctx.run(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  const clickText = (sel, re) => ctx.run(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${re}.test(e.textContent))?.click()`);

  // ---------- Anmeldung ----------
  check('Anmeldung erscheint (noch kein Profil)', await waitFor(`!!document.querySelector('.login .login-form')`));
  await ctx.wait(900); // Einsteigen der Marke und der Felder
  const look = await ctx.run(`(() => {
    const logo = { width: document.querySelector('.login .connect-logo').offsetWidth }; // Layoutgroesse: das Logo atmet (bis 1,035), die gezeichnete schwankt
    const fields = [...document.querySelectorAll('.login-fields .field')].map((f) => ({ h: Math.round(f.getBoundingClientRect().height), ph: f.placeholder, r: parseFloat(getComputedStyle(f).borderRadius) }));
    const [submit, qc] = document.querySelectorAll('.login-form .btn');
    return { logo: Math.round(logo.width), word: document.querySelector('.connect-word')?.textContent, sub: document.querySelector('.connect-sub')?.textContent, fields, submitDisabled: submit.disabled, qcDisabled: qc.disabled, qcText: qc.textContent.trim(), labels: document.querySelectorAll('.login-form label').length, glow: document.querySelector('#glow')?.dataset.scope };
  })()`);
  check('Marke wie die Apple-App: Logo 132, Schriftzug JELLYCLOUD, Satz "Mit deinem Jellyfin-Server verbinden"', look.logo === 132 && look.word === 'JELLYCLOUD' && look.sub === 'Mit deinem Jellyfin-Server verbinden', JSON.stringify(look));
  check('Drei Kapselfelder (48 hoch) ohne Beschriftung darueber, Platzhalter wie die Apple-App', look.fields.length === 3 && look.fields.every((f) => f.h === 48 && f.r >= 24) && look.labels === 0 && /192\.168\.1\.10:8096/.test(look.fields[0].ph), JSON.stringify(look.fields));
  check('"Anmelden" erst mit Adresse und Benutzer, Quick Connect erst mit Adresse; Ambient Glow der Anmeldung', look.submitDisabled && look.qcDisabled && look.qcText === 'Mit Quick Connect anmelden' && look.glow === 'signIn', JSON.stringify(look));
  await ctx.capture(path.join(out, 'QC-01-anmeldung.png'));

  await type('.login-fields input[type=text]', BASE);
  await type('.login-fields input[autocomplete=username]', 'demo');
  await type('.login-fields input[type=password]', 'falsch');
  check('Mit Adresse und Benutzer ist "Anmelden" frei', await ctx.run(`!document.querySelector('.login-form .btn.primary').disabled`));
  await click('.login-form .btn.primary');
  const bad = await waitFor(`/falsch/.test(document.querySelector('.login .form-error')?.textContent ?? '')`, 6000);
  check('Falsches Passwort: Meldung, Benutzer und Passwort rot umrandet, die Adresse nicht', bad && (await ctx.run(`document.querySelector('.login-fields input[type=password]').getAttribute('aria-invalid') === 'true' && document.querySelector('.login-fields input[autocomplete=username]').getAttribute('aria-invalid') === 'true' && !document.querySelector('.login-fields input[type=text]').hasAttribute('aria-invalid')`)));
  await type('.login-fields input[type=password]', 'x');
  check('...die Markierung geht mit der naechsten Eingabe', await ctx.run(`!document.querySelector('.login-fields input[type=password]').hasAttribute('aria-invalid')`));
  await type('.login-fields input[type=text]', 'http://127.0.0.1:1');
  await click('.login-form .btn.primary');
  check('Unter der Adresse kein Server: die Adresse ist markiert', await waitFor(`document.querySelector('.login-fields input[type=text]').getAttribute('aria-invalid') === 'true'`, 9000));
  await type('.login-fields input[type=text]', BASE);

  // Quick Connect bei der Anmeldung: Karte mit dem Code in Kacheln, "Zurueck" bringt die Maske mit den Eingaben
  await post('/__debug/quickconnect?hold=1');
  await clickText('.login-form .btn', '/Quick Connect/');
  check('Quick Connect: die Maske weicht der Karte mit dem Code in sechs Kacheln (42 x 54)', await waitFor(`!!document.querySelector('.login .qc-panel .qc-digits')`, 6000));
  await ctx.wait(450); // die Karte blendet mit 0,96 ein: gemessen wird danach
  const tiles = await ctx.run(`(() => { const t = [...document.querySelectorAll('.login .qc-tile')]; const r = t[0].getBoundingClientRect(); return { n: t.length, code: t.map((x) => x.textContent).join(''), w: Math.round(r.width), h: Math.round(r.height), size: getComputedStyle(t[0]).fontSize, weight: getComputedStyle(t[0]).fontWeight, form: !!document.querySelector('.login-form:not([hidden])'), wait: document.querySelector('.login .qc-wait')?.textContent, card: parseFloat(getComputedStyle(document.querySelector('.login .qc-panel')).borderRadius) }; })()`);
  check('...Code 482913, Ziffern 30 fett, Karte gerundet 22, "Warte auf Bestaetigung", die Felder sind weg', tiles.n === 6 && tiles.code === '482913' && tiles.w === 42 && tiles.h === 54 && tiles.size === '30px' && Number(tiles.weight) >= 700 && tiles.card === 22 && !tiles.form && /Warte auf Best/.test(tiles.wait), JSON.stringify(tiles));
  await ctx.capture(path.join(out, 'QC-02-anmeldung-code.png'));
  await clickText('.login .qc-panel .btn', '/Zur/');
  check('"Zurueck": die Maske ist wieder da, die Eingaben auch', await waitFor(`!!document.querySelector('.login-form:not([hidden])') && document.querySelector('.login-fields input[autocomplete=username]').value === 'demo' && !document.querySelector('.login .qc-panel')`, 3000));
  await post('/__debug/quickconnect?hold=0');
  await clickText('.login-form .btn', '/Quick Connect/');
  check('Bestaetigt das andere Geraet, ist die App angemeldet', await waitFor(`!!document.querySelector('.topbar') && !document.querySelector('.login')`, 12000));
  await ctx.wait(1200);

  // ---------- Einstellungen > Konto ----------
  await ctx.run(`location.hash = '#/settings/account'`);
  await waitFor(`!!document.querySelector('.settings-panel .info-row')`);
  const connected = await waitFor(`[...document.querySelectorAll('.settings-panel .info-row')].some((r) => /Verbindung/.test(r.textContent) && /Verbunden/.test(r.textContent))`, 6000);
  const acct = await ctx.run(`(() => { const rows = [...document.querySelectorAll('.settings-panel .info-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()); return { rows, profiles: [...document.querySelectorAll('.settings-panel a.link-row')].map((a) => a.innerText.replace(/\\s+/g, ' ').trim()), qc: !!document.querySelector('.settings-panel .link-row .ico svg') && [...document.querySelectorAll('.settings-panel .link-row')].some((r) => /Quick Connect/.test(r.textContent)), out: [...document.querySelectorAll('.settings-panel .link-row.danger')].map((r) => r.textContent.trim()), foot: [...document.querySelectorAll('.settings-panel .group-foot')].map((p) => p.textContent) }; })()`);
  check('Aktuelles Profil: Server, Benutzer, Adresse, Verbindung "Verbunden"', connected && acct.rows.length === 4 && /Mock Jellyfin/.test(acct.rows[0]) && /demo/.test(acct.rows[1]) && acct.rows[2].includes('127.0.0.1') && /Verbunden/.test(acct.rows[3]), JSON.stringify(acct.rows));
  check('Profile: das aktive mit "Aktiv", Text zur Grenze von vier Profilen; Quick Connect; Abmelden mit Erklaerung', acct.profiles.length === 1 && /Aktiv/.test(acct.profiles[0]) && acct.qc && acct.out.includes('Abmelden') && acct.foot.some((f) => /höchstens 4 Profile/.test(f)) && acct.foot.some((f) => /Einstellungen der App/.test(f)), JSON.stringify(acct));
  await ctx.wait(700); // die Seite blendet ein: danach aufnehmen
  await ctx.capture(path.join(out, 'QC-03-konto.png'));

  // Abmelden fragt nach; Abbrechen laesst alles, wie es ist
  await clickText('.settings-panel .link-row.danger', '/Abmelden/');
  check('Abmelden fragt nach und erklaert, was bleibt', await waitFor(`/Einstellungen der App bleiben/.test(document.querySelector('.mdl')?.textContent ?? '')`, 3000));
  await clickText('.mdl .btn', '/Abbrechen/');
  await ctx.wait(400);
  check('...Abbrechen: weiter angemeldet', await ctx.run(`!document.querySelector('.login') && !!document.querySelector('.settings-panel .info-row')`));

  // ---------- Maske Quick Connect ----------
  await clickText('.settings-panel .link-row', '/Quick Connect/');
  check('Die Maske liegt ueber der ganzen App', await waitFor(`!!document.querySelector('.connect-overlay .qc-input')`, 5000));
  await ctx.wait(500);
  const mask = await ctx.run(`(() => {
    const o = document.querySelector('.connect-overlay');
    const shell = [...document.querySelectorAll('#app > :not(.connect-overlay)')];
    const hit = document.elementFromPoint(innerWidth / 2, 30);
    return { covered: document.documentElement.classList.contains('covered'), inert: shell.every((e) => e.inert), hidden: shell.every((e) => getComputedStyle(e).visibility === 'hidden'), topHit: !!hit && !!hit.closest('.connect-overlay'),
      who: o.querySelector('.qc-who')?.innerText.replace(/\\s+/g, ' ').trim(), confirmDisabled: o.querySelector('.qc-body .btn.primary')?.disabled, focus: document.activeElement?.classList.contains('qc-input'), glow: document.querySelector('#glow')?.dataset.scope, sub: o.querySelector('.connect-sub')?.textContent, tiles: o.querySelectorAll('.qc-tile').length, cancel: !!o.querySelector('.connect-cancel:not([hidden])') };
  })()`);
  check('Darunter ist alles verdeckt und gesperrt (inert, unsichtbar), ein Klick oben trifft die Maske', mask.covered && mask.inert && mask.hidden && mask.topHit, JSON.stringify(mask));
  check('Als wer und wo: Benutzer des Servers, Servername und Adresse; sechs leere Kacheln, "Bestaetigen" gesperrt, der Fokus im Feld', /Es wird angemeldet als demo/.test(mask.who) && /Mock Jellyfin · http:\/\/127\.0\.0\.1:8995/.test(mask.who) && mask.tiles === 6 && mask.confirmDisabled && mask.focus && mask.cancel, JSON.stringify(mask));
  check('Ambient Glow der Anmeldung, Satz "Ein anderes Geraet mit deinem Profil anmelden"', mask.glow === 'signIn' && mask.sub === 'Ein anderes Gerät mit deinem Profil anmelden', JSON.stringify(mask));
  // Tastenkuerzel der App ruhen (der Schraegstrich oeffnete sonst die Suche)
  await ctx.run(`document.querySelector('.connect-overlay .qc-input').blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))`);
  await ctx.wait(300);
  check('Tastenkuerzel der App wirken nicht durch die Maske', await ctx.run(`location.hash === '#/settings/account'`), await ctx.run('location.hash'));
  // Einfuegen mit Leerzeichen: bereinigt; die naechste freie Kachel ist umrandet
  await type('.connect-overlay .qc-input', '11 11');
  const partial = await ctx.run(`(() => { const t = [...document.querySelectorAll('.connect-overlay .qc-tile')]; return { code: t.map((x) => x.textContent).join(''), next: t.findIndex((x) => x.classList.contains('next')), value: document.querySelector('.connect-overlay .qc-input').value, confirm: document.querySelector('.connect-overlay .qc-body .btn.primary').disabled }; })()`);
  check('Eingabe bereinigt (nur Ziffern), Kacheln zeigen sie, die naechste freie ist umrandet, "Bestaetigen" noch gesperrt', partial.code === '1111' && partial.value === '1111' && partial.next === 4 && partial.confirm, JSON.stringify(partial));
  await type('.connect-overlay .qc-input', '1111117');
  check('Hoechstens sechs Ziffern; dann ist "Bestaetigen" frei', await ctx.run(`document.querySelector('.connect-overlay .qc-input').value === '111111' && !document.querySelector('.connect-overlay .qc-body .btn.primary').disabled`));
  // wie ein Mausklick: der Fokus geht erst an den Knopf, dann der Klick
  await ctx.run(`(() => { const b = document.querySelector('.connect-overlay .qc-body .btn.primary'); b.focus(); b.click(); })()`);
  const unknown = await waitFor(`/ungültig oder abgelaufen/.test(document.querySelector('.connect-overlay .qc-error')?.textContent ?? '')`, 6000);
  check('Falscher Code: Meldung, alle Kacheln rot umrandet, der Code bleibt zum Korrigieren, der Fokus bleibt im Feld', unknown && (await ctx.run(`document.querySelector('.connect-overlay .qc-digits').classList.contains('invalid') && document.querySelector('.connect-overlay .qc-input').value === '111111' && document.activeElement === document.querySelector('.connect-overlay .qc-input')`)), await ctx.run(`document.activeElement?.className`));
  await ctx.capture(path.join(out, 'QC-04-maske-falsch.png'));
  await type('.connect-overlay .qc-input', '11111');
  check('...die Meldung geht mit der naechsten Eingabe', await ctx.run(`!document.querySelector('.connect-overlay .qc-digits').classList.contains('invalid') && document.querySelector('.connect-overlay .qc-error').hidden`));
  // Der richtige Code (das andere Geraet hat ihn eben angefordert): Erfolg
  await post('/QuickConnect/Initiate');
  state.log.length = 0;
  await type('.connect-overlay .qc-input', '482913');
  await ctx.run(`window.__qcField = document.querySelector('.connect-overlay .qc-input')`);
  await ctx.run(`document.querySelector('.connect-overlay .qc-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  const done = await waitFor(`/Gerät bestätigt/.test(document.querySelector('.connect-overlay .qc-outcome')?.textContent ?? '')`, 6000);
  const doneInfo = await ctx.run(`({ text: document.querySelector('.connect-overlay .qc-outcome')?.innerText, cancel: !!document.querySelector('.connect-overlay .connect-cancel:not([hidden])'), btn: document.querySelector('.connect-overlay .qc-body .btn.primary')?.textContent, field: window.__qcField?.value, attached: !!window.__qcField?.isConnected })`);
  check('Eingabetaste bestaetigt: "Geraet bestaetigt", meldet sich als demo an, nur noch "Fertig" (kein Abbrechen); der Code ist auch aus dem Feld weg', done && /als demo an/.test(doneInfo.text) && !doneInfo.cancel && doneInfo.btn === 'Fertig' && doneInfo.field === '' && !doneInfo.attached, JSON.stringify(doneInfo));
  const auth = state.log.filter((l) => l.at === 'QuickConnect/Authorize');
  check('Der Server bekam genau eine Bestaetigung mit dem Benutzer des Profils und hat den Code angenommen', auth.length === 1 && !!auth[0].userId && state.qc.authorized === true, JSON.stringify(auth));
  await ctx.capture(path.join(out, 'QC-05-maske-bestaetigt.png'));
  const cfg = fs.readFileSync(path.join(ctx.app.getPath('userData'), 'config.json'), 'utf8');
  check('Der Code steht nicht in der Konfiguration', !cfg.includes('482913') && !cfg.includes('111111'));
  await clickText('.connect-overlay .qc-body .btn', '/Fertig/');
  const closed = await waitFor(`!document.querySelector('.connect-overlay') && !document.documentElement.classList.contains('covered') && [...document.querySelectorAll('#app > *')].every((e) => !e.inert)`, 3000);
  check('"Fertig": die Maske ist zu, die App wieder bedienbar, Glow der Einstellungen, der Fokus wieder auf der Zeile', closed && (await ctx.run(`document.querySelector('#glow')?.dataset.scope === 'settings' && /Quick Connect/.test(document.activeElement?.textContent ?? '')`)), await ctx.run(`document.querySelector('#glow')?.dataset.scope + ' / ' + document.activeElement?.className`));

  // Schon bestaetigt, dann Escape
  await clickText('.settings-panel .link-row', '/Quick Connect/');
  await waitFor(`!!document.querySelector('.connect-overlay .qc-input')`, 5000);
  await type('.connect-overlay .qc-input', '482913');
  await click('.connect-overlay .qc-body .btn.primary');
  check('Schon bestaetigter Code: eigene Meldung', await waitFor(`/schon bestätigt/.test(document.querySelector('.connect-overlay .qc-error')?.textContent ?? '')`, 6000));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  check('Escape schliesst die Maske', await waitFor(`!document.querySelector('.connect-overlay') && !document.documentElement.classList.contains('covered')`, 3000));

  // Am Server ausgeschaltet: die Maske sagt es beim Oeffnen; "Erneut pruefen" nach dem Einschalten bringt die Eingabe
  await post('/__debug/quickconnect?disabled=1');
  await clickText('.settings-panel .link-row', '/Quick Connect/');
  check('Quick Connect am Server aus: Hinweis mit "Erneut pruefen", keine Eingabe', await waitFor(`/ausgeschaltet/.test(document.querySelector('.connect-overlay .qc-outcome')?.textContent ?? '') && !document.querySelector('.connect-overlay .qc-input')?.isConnected`, 5000));
  await ctx.wait(700); // die Seite blendet ein: danach aufnehmen
  await ctx.capture(path.join(out, 'QC-06-maske-aus.png'));
  await post('/__debug/quickconnect?disabled=0');
  await clickText('.connect-overlay .qc-body .btn', '/Erneut prüfen/');
  check('...eingeschaltet und erneut geprueft: die Eingabe ist da', await waitFor(`!!document.querySelector('.connect-overlay .qc-input')?.isConnected`, 5000));
  await click('.connect-overlay .connect-cancel');
  await waitFor(`!document.querySelector('.connect-overlay')`, 3000);

  // ---------- Profil bearbeiten ----------
  await click('.settings-panel a.link-row');
  check('Ein Tipp auf das Profil oeffnet das Bearbeiten', await waitFor(`/profile=/.test(location.hash) && !!document.querySelector('.settings-panel .save-row')`, 4000));
  const editor = await ctx.run(`(() => { const [name, addr] = document.querySelectorAll('.settings-panel .setting .field'); return { name: name.value, ph: name.placeholder, addr: addr.value, save: document.querySelector('.settings-panel .save-row .btn').disabled, rows: [...document.querySelectorAll('.settings-panel .link-row')].map((r) => r.textContent.trim()) }; })()`);
  check('Name (leer: Benutzername), Serveradresse, "Speichern" erst mit einer Aenderung; das aktive Profil hat kein "Wechseln", aber "Profil entfernen"', editor.name === '' && editor.ph === 'Name (leer: demo)' && editor.addr === BASE && editor.save && editor.rows.includes('Profil entfernen') && !editor.rows.some((r) => /wechseln/.test(r)), JSON.stringify(editor));
  await ctx.wait(700); // die Seite blendet ein: danach aufnehmen
  await ctx.capture(path.join(out, 'QC-07-profil.png'));
  await type('.settings-panel .setting .field', 'Wohnzimmer');
  await click('.settings-panel .save-row .btn');
  check('Umbenannt: "Gespeichert", der Titel heisst jetzt so', await waitFor(`document.querySelector('.settings-panel .save-row .btn').textContent === 'Gespeichert' && document.querySelector('.settings-panel .sub-title').textContent === 'Wohnzimmer'`, 4000));
  // Neue Adresse fuer denselben Server (localhost statt 127.0.0.1): bleibt angemeldet, die Kennung wechselt
  const oldHash = await ctx.run('location.hash');
  await ctx.run(`(() => { const f = document.querySelectorAll('.settings-panel .setting .field')[1]; f.value = 'http://localhost:${PORT}'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('.settings-panel .save-row .btn');
  const moved = await waitFor(`document.querySelector('.settings-panel .save-row .btn').textContent === 'Gespeichert' && document.querySelectorAll('.settings-panel .setting .field')[1].value === 'http://localhost:${PORT}'`, 8000);
  check('Neue Adresse desselben Servers: gespeichert, das Profil bleibt angemeldet und aktiv, die Adresse in der Leiste wechselt mit', moved && (await ctx.run(`location.hash !== ${JSON.stringify(oldHash)} && /profile=/.test(location.hash)`)) && ctx.config.data.servers.length === 1 && ctx.config.data.servers[0].url === `http://localhost:${PORT}` && ctx.config.data.servers[0].label === 'Wohnzimmer' && ctx.config.data.activeServerId === ctx.config.data.servers[0].id, JSON.stringify(ctx.config.data.servers.map((s) => ({ url: s.url, label: s.label }))));
  // Fremder Server unter der Adresse: abgelehnt, das Feld rot, nichts aendert sich
  await ctx.run(`(() => { const f = document.querySelectorAll('.settings-panel .setting .field')[1]; f.value = 'http://127.0.0.1:${PORT + 100}'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('.settings-panel .save-row .btn');
  check('Adresse eines anderen Servers: abgelehnt mit Erklaerung, das Feld markiert, die alte Adresse bleibt', await waitFor(`/anderer Server/.test(document.querySelector('.settings-panel .save-row .form-error')?.textContent ?? '') && document.querySelectorAll('.settings-panel .setting .field')[1].getAttribute('aria-invalid') === 'true'`, 8000) && ctx.config.data.servers[0].url === `http://localhost:${PORT}`);
  await ctx.wait(700); // die Seite blendet ein: danach aufnehmen
  await ctx.capture(path.join(out, 'QC-08-profil-fremder-server.png'));
  await ctx.run(`(() => { const f = document.querySelectorAll('.settings-panel .setting .field')[1]; f.value = ${JSON.stringify(BASE)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('.settings-panel .save-row .btn');
  await waitFor(`document.querySelector('.settings-panel .save-row .btn').textContent === 'Gespeichert'`, 8000);
  await click('.settings-panel .settings-back');
  await waitFor(`!!document.querySelector('.settings-panel .info-row')`, 4000);
  check('Zurueck in der Uebersicht: das Profil heisst "Wohnzimmer", Adresse wieder 127.0.0.1', await ctx.run(`/Wohnzimmer/.test(document.querySelector('.settings-panel a.link-row')?.textContent ?? '') && [...document.querySelectorAll('.settings-panel .info-row')].some((r) => r.textContent.includes('127.0.0.1:${PORT}'))`));

  // Ein zweites Profil (dieselbe Anmeldung unter der Adresse localhost) und es wieder entfernen
  await ctx.run(`window.jc.login({ url: 'http://localhost:${PORT}', username: 'demo', password: 'demo' })`);
  await ctx.run(`window.jc.switchServer(${JSON.stringify(ctx.config.data.servers[0].id)}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`document.querySelectorAll('.settings-panel a.link-row').length === 2`, 8000);
  const second = ctx.config.data.servers[1].id;
  state.log.length = 0;
  await click(`.settings-panel a.link-row[href$="${encodeURIComponent(second)}"]`);
  await waitFor(`[...document.querySelectorAll('.settings-panel .link-row')].some((r) => /wechseln/.test(r.textContent))`, 4000);
  check('Ein anderes Profil: "Zu diesem Profil wechseln" und "Profil entfernen"', await ctx.run(`[...document.querySelectorAll('.settings-panel .link-row')].map((r) => r.textContent.trim()).join('|') === 'Zu diesem Profil wechseln|Profil entfernen'`));
  await clickText('.settings-panel .link-row.danger', '/entfernen/');
  check('Entfernen fragt nach und nennt das Profil', await waitFor(`/„demo“ wird von diesem Gerät entfernt/.test(document.querySelector('.mdl')?.textContent ?? '')`, 3000));
  await clickText('.mdl .btn', '/^Entfernen$/');
  check('Entfernt: abgemeldet am Server, nur das aktive Profil bleibt, Uebersicht', await waitFor(`!/profile=/.test(location.hash) && document.querySelectorAll('.settings-panel a.link-row').length === 1`, 5000) && ctx.config.data.servers.length === 1 && state.log.some((l) => l.at === '/Sessions/Logout'), JSON.stringify(state.log.slice(-6)));

  // ---------- Rueckkehr in die App und Start ohne Server ----------
  const meBefore = state.log.filter((l) => l.at === '/Users/Me').length;
  await ctx.run(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
  await ctx.wait(200);
  await ctx.run(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`);
  check('Rueckkehr in die App: die Verbindung wird geprueft (/Users/Me)', await (async () => { const end = Date.now() + 4000; while (Date.now() < end) { if (state.log.filter((l) => l.at === '/Users/Me').length > meBefore) return true; await ctx.wait(80); } return false; })());
  await stop();
  await ctx.run(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
  await ctx.wait(200);
  await ctx.run(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`);
  check('Server weg, Rueckkehr: "Verbindung" zeigt "Nicht erreichbar", die App bleibt angemeldet', await waitFor(`[...document.querySelectorAll('.settings-panel .info-row')].some((r) => /Nicht erreichbar/.test(r.textContent)) && !document.querySelector('.login')`, 8000));
  // Neustart der Oberflaeche ohne Server (wie ein Start der App)
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  check('Start ohne Server: "Server nicht erreichbar" mit "Erneut versuchen", nicht die Anmeldung', await waitFor(`/Server nicht erreichbar/.test(document.querySelector('.start-status')?.textContent ?? '') && !document.querySelector('.login')`, 10000));
  const offline = await ctx.run(`(() => { const st = document.querySelector('.start-status .page-status'); const n = st.querySelector('.ps-notice').getBoundingClientRect(); return { btn: st.querySelector('.ps-action .btn')?.textContent, other: st.querySelector('.ps-action .link-btn')?.textContent, cy: (n.top + n.bottom) / 2, h: innerHeight, glow: document.querySelector('#glow')?.dataset.scope }; })()`);
  check('...mittig im Fenster, mit dem Weg zu einem anderen Profil; Anmeldung und Profil bleiben gespeichert', offline.btn === 'Erneut versuchen' && /Anderes Profil/.test(offline.other) && Math.abs(offline.cy - offline.h / 2) <= 3 && ctx.config.data.servers.length === 1 && !!ctx.config.getServer().token, JSON.stringify(offline));
  await ctx.wait(700); // die Seite blendet ein: danach aufnehmen
  await ctx.capture(path.join(out, 'QC-09-start-offline.png'));
  await listen();
  await click('.start-status .ps-action .btn');
  check('Server wieder da, "Erneut versuchen": die App steht', await waitFor(`!!document.querySelector('.topbar') && !document.querySelector('.start-status')`, 10000));

  // Abgelaufene Anmeldung bei der Rueckkehr: die Anmeldung erscheint (wie bei jedem 401)
  await ctx.wait(800);
  await post('/__debug/expire');
  await ctx.run(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
  await ctx.wait(200);
  await ctx.run(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`);
  check('Abgelaufene Anmeldung bei der Rueckkehr: die Anmeldung erscheint', await waitFor(`!!document.querySelector('.login .login-form')`, 8000));

  console.log('Konsolenfehler:', consoleErrors.length ? `\n${consoleErrors.join('\n')}` : 'keine');
  console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
  if (fail) process.exitCode = 1;
  other.close();
  await stop();
};
