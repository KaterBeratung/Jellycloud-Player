// Seerr ohne Passwort (wie SeerrSection der Apple-App, Build 94), mit dem Mock-Server auf Port 8960:
//  - nicht verbunden: oben Adresse und Hauptknopf "Ohne Passwort verbinden", darunter "Oder mit Passwort" (Konto, Passwort, Glasknopf)
//  - Ohne Passwort: Seerr holt einen Code, die App bestaetigt ihn mit der Sitzung des Profils bei Jellyfin, verbunden; genau ein Code
//  - danach fragt die App einmal "Mitteilungen aktivieren?" (wenn das System Mitteilungen anbietet); nach "Nicht jetzt" nie wieder
//  - Fehlerbilder: Seerr ohne diesen Weg (404), fremdes Konto (Sitzung verworfen), Meldung unter dem Hauptknopf; der Weg mit Passwort bleibt
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr-quick.js
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
  const PORT = 8960;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' }).then((r) => r.json());
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  ctx.win.setContentSize(1180, 860);
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(800);

  // ---------- Hinweis auf der Startseite (SeerrConnectTip der Apple-App) ----------
  const tipShown = await waitFor(`!!document.querySelector('.home .seerr-tip')`, 6000);
  const tip = await ctx.run(`(() => { const t = document.querySelector('.home .seerr-tip'); const r = t?.getBoundingClientRect(); const bar = document.querySelector('.topbar')?.getBoundingClientRect(); return t ? { title: t.querySelector('strong').textContent, btn: t.querySelector('[data-action="seerr-tip-connect"]')?.textContent, below: r.top >= bar.bottom - 1, right: Math.round(innerWidth - r.right) } : null; })()`);
  check('Startseite ohne Seerr: Hinweis "Seerr verbinden" unter der Kopfleiste mit "Verbinden"', tipShown && tip?.title === 'Seerr verbinden' && tip.btn === 'Verbinden' && tip.below, JSON.stringify(tip));
  await ctx.capture(path.join(out, 'SQ-tip.png'));
  await ctx.run(`document.querySelector('.home .seerr-tip [data-action="seerr-tip-connect"]').click()`);
  check('"Verbinden" fuehrt zu Einstellungen > Anfragen (Seerr)', await waitFor(`location.hash === '#/settings/seerr'`, 4000));
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(500);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(1200);
  check('Der Hinweis kommt fuer dieses Profil nicht wieder', !(await ctx.run(`!!document.querySelector('.seerr-tip')`)));
  const open = async () => {
    await ctx.run(`location.hash = '#/settings/seerr'`);
    await waitFor(`!!document.querySelector('[data-action="seerr-quick"]') || !!document.querySelector('.status-row')`);
    await ctx.wait(400);
  };
  // Nach einer Aenderung ueber die Schnittstelle (Trennen): die Oberflaeche liest den Stand neu wie nach einer Anmeldung
  const fresh = async () => {
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await waitFor(`!!document.querySelector('.topbar')`);
    await ctx.wait(800);
    await open();
  };
  await open();

  // ---------- Aufbau ----------
  const look = await ctx.run(`(() => {
    const blocks = [...document.querySelectorAll('.settings-stack > .settings-block')];
    const quick = document.querySelector('[data-action="seerr-quick"]'), pw = document.querySelector('[data-action="seerr-password"]');
    return { blocks: blocks.length, heads: blocks.map((b) => b.querySelector('.group-title')?.textContent ?? ''), quick: quick?.textContent, quickPrimary: quick?.classList.contains('primary'), quickBlock: blocks.indexOf(quick?.closest('.settings-block')), pw: pw?.textContent, pwPrimary: pw?.classList.contains('primary'), pwBlock: blocks.indexOf(pw?.closest('.settings-block')), addressFirst: !!blocks[0]?.querySelector('input[inputmode="url"]'), fields: blocks[1]?.querySelectorAll('input').length };
  })()`);
  check('Aufbau: oben Adresse und Hauptknopf "Ohne Passwort verbinden"', look.addressFirst && look.quick === 'Ohne Passwort verbinden' && look.quickPrimary && look.quickBlock === 0, JSON.stringify(look));
  check('Aufbau: darunter "Oder mit Passwort" mit Konto, Passwort und Glasknopf', look.heads[1] === 'Oder mit Passwort' && look.fields === 2 && look.pw === 'Mit Passwort verbinden' && !look.pwPrimary && look.pwBlock === 1);
  await ctx.capture(path.join(out, 'SQ-form.png'));

  // ---------- Ohne Passwort verbinden ----------
  const before = state.log.filter((l) => l.at === 'QuickConnect/Authorize').length;
  await ctx.run(`(() => { const u = document.querySelector('input[inputmode="url"]'); u.value = '${BASE}'; u.dispatchEvent(new Event('input')); document.querySelector('[data-action="seerr-quick"]').click(); })()`);
  const connected = await waitFor(`!!document.querySelector('.status-row') || !!document.querySelector('.mdl-scrim')`, 10000);
  const authorized = state.log.filter((l) => l.at === 'QuickConnect/Authorize');
  check('Ohne Passwort: verbunden, genau ein Code bestaetigt, mit dem Konto des Profils', connected && authorized.length - before === 1 && (SEERR.counters.qcInitiates ?? 0) === 1, `${authorized.length - before} Bestaetigungen, ${SEERR.counters.qcInitiates} Codes`);
  const sys = await ctx.run(`window.jc.notificationSystemStatus ? window.jc.notificationSystemStatus() : null`);
  const offer = await waitFor(`!!document.querySelector('.mdl-scrim .mdl-title')`, 3000);
  if (sys?.supported) {
    const dlg = await ctx.run(`({ title: document.querySelector('.mdl-scrim .mdl-title')?.textContent, buttons: [...document.querySelectorAll('.mdl-scrim .mdl-actions button')].map((b) => b.textContent) })`);
    check('Danach einmal die Frage "Mitteilungen aktivieren?" mit "Nicht jetzt" und "Aktivieren"', offer && dlg.title === 'Mitteilungen aktivieren?' && dlg.buttons.join('|') === 'Nicht jetzt|Aktivieren', JSON.stringify(dlg));
    await ctx.capture(path.join(out, 'SQ-offer.png'));
    await ctx.run(`[...document.querySelectorAll('.mdl-scrim .mdl-actions button')].find((b) => b.textContent === 'Nicht jetzt')?.click()`);
    await ctx.wait(500);
    const prefs = await ctx.run(`window.jc.notifications().then((d) => ({ system: d.preferences.system, offered: d.offered }))`);
    check('"Nicht jetzt": Mitteilungen des Systems bleiben aus, die Frage ist gemerkt', prefs.system === false && prefs.offered === true, JSON.stringify(prefs));
  } else check('System ohne Mitteilungen: keine Frage', !offer, JSON.stringify(sys));
  await waitFor(`!!document.querySelector('.status-row[data-state="connected"]')`, 8000);
  check('Seite zeigt "verbunden" mit dem Konto des Profils', await ctx.run(`!!document.querySelector('.status-row[data-state="connected"]') && document.body.textContent.includes('demo')`));
  await ctx.capture(path.join(out, 'SQ-connected.png'));

  // Trennen und erneut ohne Passwort: keine zweite Frage
  await ctx.run(`window.jc.seerrDisconnect()`);
  await fresh();
  await ctx.run(`document.querySelector('[data-action="seerr-quick"]').click()`);
  await waitFor(`!!document.querySelector('.status-row')`, 10000);
  await ctx.wait(800);
  check('Erneut verbunden: die Frage kommt nicht noch einmal', !(await ctx.run(`!!document.querySelector('.mdl-scrim')`)));

  // ---------- Fehlerbilder ----------
  const failWith = async (mode) => {
    await ctx.run(`window.jc.seerrDisconnect()`);
    await debug(`qc?set=${mode}`);
    await fresh();
    await ctx.run(`document.querySelector('[data-action="seerr-quick"]').click()`);
    await waitFor(`!!document.querySelector('[data-action="seerr-quick"]')?.closest('.setting')?.querySelector('.form-error')?.textContent`, 8000);
    return ctx.run(`({ msg: document.querySelector('[data-action="seerr-quick"]').closest('.setting').querySelector('.form-error').textContent, connected: !!document.querySelector('.status-row'), pwErr: document.querySelector('[data-action="seerr-password"]').closest('.setting').querySelector('.form-error').textContent })`);
  };
  const old = await failWith('unsupported');
  check('Seerr ohne Quick Connect: Meldung unter dem Hauptknopf, verweist auf Konto und Passwort', !old.connected && /bietet Quick Connect nicht an/.test(old.msg) && !old.pwErr, JSON.stringify(old));
  await ctx.capture(path.join(out, 'SQ-unsupported.png'));
  const foreign = await failWith('foreign');
  const st = await ctx.run(`window.jc.getState().then((s) => s.seerr)`);
  check('Fremdes Konto: verworfen, nicht verbunden', !foreign.connected && /anderes Konto/.test(foreign.msg) && st === null, JSON.stringify(foreign));
  await debug('qc?set=ok');
  // Der Weg mit Passwort bleibt
  await ctx.run(`(() => { const [u, p] = document.querySelectorAll('.settings-stack > .settings-block:nth-child(2) input'); u.value = 'demo'; u.dispatchEvent(new Event('input')); p.value = 'demo'; p.dispatchEvent(new Event('input')); document.querySelector('[data-action="seerr-password"]').click(); })()`);
  check('Mit Passwort verbinden geht weiter', await waitFor(`!!document.querySelector('.status-row')`, 8000));

  check('Keine Fehler in der Konsole', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
