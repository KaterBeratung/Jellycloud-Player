// Mitteilungen des Systems (P18, nach SystemNotificationRows, SystemNotificationMessage und den Notizen der Apple-App) mit dem Mock-Server auf Port 8984.
// Die Benachrichtigungen von Windows faengt eine Attrappe ab (ctx.notifier.create): es erscheint nie eine echte Mitteilung.
//  - Einstellungen > Mitteilungen: "Mitteilungen des Systems" unter dem Hauptschalter, Standard aus; eingeschaltet der Weg in die Windows-Einstellungen
//  - an das System nur, was neu ist, und nur eingeschaltet; Wortlaut der App; Kennung mit dem Kennwert des Profils, keine Adresse
//  - Antippen: Fenster vorn, der Titel oeffnet sich (eine offene Quick-Connect-Maske schliesst sich), der Eintrag ist gelesen und die Mitteilung zurueckgenommen;
//    eine Mitteilung eines anderen Profils oeffnet nichts
//  - gelesen, alle entfernen und Seerr trennen nehmen zurueck; Mitteilungen aus: kein Schalter
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/system-notify.js
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

  // Attrappe statt der Notification von Electron: jede Mitteilung mit ihren Angaben, ob sie zurueckgenommen ist, und ein Antippen auf Zuruf
  const made = [];
  ctx.notifier.isSupported = () => true;
  ctx.notifier.create = (options) => {
    const on = {};
    const n = { options, shown: false, closed: false, on: (ev, cb) => (on[ev] = cb), show: () => (n.shown = true), close: () => (n.closed = true), tap: () => on.click?.() };
    made.push(n);
    return n;
  };
  const idOf = (n) => [...ctx.notifier.shown.entries()].find(([, v]) => v === n)?.[0] ?? null;

  const PORT = 8984;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  ctx.win.setContentSize(1440, 900);
  await ctx.wait(400);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(60);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 9000);
    await ctx.wait(300);
  };
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' });
  const sync = () => ctx.run(`window.jc.notificationsSync({ force: true })`);
  const item = (id) => ctx.run(`window.jc.notifications().then((d) => d.items.find((x) => x.id === ${JSON.stringify(id)}) ?? null)`);
  const labels = () => ctx.run(`[...document.querySelectorAll('.settings-panel .setting-label')].map((l) => l.textContent)`);
  const systemToggle = `[...document.querySelectorAll('.settings-panel .setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Mitteilungen des Systems')?.querySelector('.setting-control button, .setting-control input, .setting-control [role=switch]')`;
  const toggleOn = (sel) => ctx.run(`(() => { const t = ${sel}; return !!t && (t.getAttribute('aria-checked') === 'true' || t.checked === true || t.classList.contains('on')); })()`);
  const panelText = () => ctx.run(`document.querySelector('.settings-panel')?.textContent ?? ''`);

  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  SEERR.permissions = 32;
  await debug('requests?count=5&open=5&by=1'); // fuenf eigene wartende Anfragen (TMDB 90001 bis 90005)
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(1500);
  await sync(); // Ausgangsstand (der erste Abgleich ist still)

  // ---------- Einstellungen > Mitteilungen ----------
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .setting')`);
  await waitFor(`!!(${systemToggle})`, 4000);
  const l1 = await labels();
  check('Einstellungen: "Mitteilungen des Systems" unter dem Hauptschalter, vor den Arten', l1[0] === 'Mitteilungen' && l1[1] === 'Mitteilungen des Systems' && l1[2] === 'Verfügbar', JSON.stringify(l1));
  check('...Standard aus, ohne Weg in die Windows-Einstellungen; die Fusszeile nennt die Grenze', !(await toggleOn(systemToggle)) && !/Windows-Einstellungen öffnen/.test(await panelText()) && /solange Jellycloud geöffnet ist/.test(await panelText()));

  // ---------- Aus: in der App ja, an das System nicht ----------
  await debug('request?id=1&status=2');
  await sync();
  check('Ausgeschaltet: die Mitteilung steht in der App, an Windows geht keine', !!(await item('seerr-1-approved')) && made.length === 0, `Mitteilungen ${made.length}`);

  // ---------- Einschalten ----------
  await ctx.run(`${systemToggle}.click()`);
  check('Eingeschaltet: der Wunsch ist gemerkt, der Schalter steht auf Ein', await waitFor(`window.jc.notifications().then((d) => d.preferences.system === true)`, 3000) && (await waitFor(`(() => { const t = ${systemToggle}; return !!t && (t.getAttribute('aria-checked') === 'true' || t.checked === true || t.classList.contains('on')); })()`, 3000)));
  check('...darunter "Windows-Einstellungen öffnen" (Windows sagt nicht, ob es sie zeigt)', await waitFor(`/Windows-Einstellungen öffnen/.test(document.querySelector('.settings-panel')?.textContent ?? '')`, 3000));
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'SN-01-einstellungen.png'));
  check('Einschalten zeigt nichts nach (die Mitteilung von vorhin bleibt in der App)', made.length === 0);

  // ---------- Neues geht an das System ----------
  await debug('request?id=2&status=5');
  await sync();
  await ctx.wait(200);
  const m1 = made[0];
  check('Neu und eingeschaltet: genau eine Mitteilung von Windows', made.length === 1 && !!m1?.shown, `Mitteilungen ${made.length}`);
  check('...mit dem Wortlaut der App (Ueberschrift als Titel, Text als Inhalt)', m1?.options.title === 'Dein angefragter Film ist jetzt verfügbar' && m1?.options.body === '„Anfrage 90002“ wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.', JSON.stringify(m1?.options));
  const id1 = idOf(m1);
  check('...Kennung aus dem Kennwert des Profils und der Kennung des Eintrags, ohne Adresse', /^[0-9a-f]{12}\.seerr-2-available$/.test(id1 ?? '') && !JSON.stringify([...ctx.notifier.shown.keys()]).includes('127.0.0.1'), id1);
  await sync();
  check('Ein weiterer Abgleich bringt keine zweite', made.length === 1);

  // ---------- Antippen ----------
  await go('#/home', `!!document.querySelector('.home')`);
  ctx.win.minimize();
  await ctx.wait(500);
  m1.tap();
  check('Antippen: das Fenster kommt nach vorn', await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { if (!ctx.win.isMinimized() && ctx.win.isVisible()) return true; await ctx.wait(60); } return false; })());
  check('...und der Titel oeffnet sich (nicht in der Mediathek: seine Seite bei Seerr), nie eine Wiedergabe', await waitFor(`location.hash === '#/seerr/movie/90002' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Anfrage 90002'`, 6000), await ctx.run('location.hash'));
  check('...der Eintrag ist gelesen und die Mitteilung zurueckgenommen', (await item('seerr-2-available'))?.read === true && m1.closed);
  await ctx.capture(path.join(out, 'SN-02-titel.png'));

  // Eine Mitteilung eines anderen Profils: die App kommt nach vorn, oeffnet aber nichts und wechselt kein Profil
  await go('#/home', `!!document.querySelector('.home')`);
  const activeProfile = () => ctx.run(`window.jc.getState().then((s) => s.activeServerId)`);
  const hashBefore = await ctx.run('location.hash');
  const profileBefore = await activeProfile();
  ctx.notifier.show([{ id: 'abcdef123456.seerr-3-approved', title: 'Anfrage genehmigt', body: '„Anfrage 90003“ wurde genehmigt und wird jetzt beschafft.', target: { id: 'seerr-3-approved', mediaType: 'movie', tmdbId: 90003, title: 'Anfrage 90003', profile: 'abcdef123456', state: 'approved' } }]);
  made.at(-1).tap();
  await ctx.wait(1200);
  check('Mitteilung eines anderen Profils: nichts oeffnet sich, das Profil bleibt', (await ctx.run('location.hash')) === hashBefore && !!profileBefore && (await activeProfile()) === profileBefore && (await item('seerr-3-approved')) === null, await ctx.run('location.hash'));
  ctx.notifier.withdraw(['abcdef123456.seerr-3-approved']);

  // Offene Quick-Connect-Maske: sie schliesst sich, sonst laege der Titel unsichtbar darunter
  await debug('request?id=3&status=5');
  await sync();
  const m2 = made.at(-1);
  check('Die naechste Aenderung kommt als eigene Mitteilung', made.length === 3 && /seerr-3-available$/.test(idOf(m2) ?? ''), idOf(m2));
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Quick Connect/.test(b.textContent))?.click()`);
  const qcOpen = await waitFor(`!!document.querySelector('.connect-overlay') && document.documentElement.classList.contains('covered')`, 5000);
  m2.tap();
  check('Offene Quick-Connect-Maske: sie schliesst sich, der Titel ist zu sehen', qcOpen && (await waitFor(`!document.documentElement.classList.contains('covered') && !document.querySelector('.connect-overlay') && location.hash === '#/seerr/movie/90003'`, 6000)), `Maske ${qcOpen}, ${await ctx.run('location.hash')}`);

  // ---------- Zuruecknehmen ----------
  await debug('request?id=4&status=3');
  await debug('request?id=5&status=4');
  await sync();
  const byEnd = (end) => made.find((n) => (idOf(n) ?? '').endsWith(end));
  const m4 = byEnd('.seerr-4-declined');
  const m5 = byEnd('.seerr-5-failed');
  check('Zwei Aenderungen, zwei Mitteilungen', made.length === 5 && !!m4 && !!m5, JSON.stringify(made.map(idOf)));
  await ctx.run(`window.jc.notificationRead({ id: 'seerr-4-declined' })`);
  check('Gelesen in der App: ihre Mitteilung ist zurueckgenommen, die andere bleibt', m4.closed && !m5.closed);
  await ctx.run(`window.jc.notificationRead({ id: 'seerr-4-declined', read: false })`);
  check('Wieder ungelesen holt keine zurueck', made.length === 5);
  await ctx.run(`window.jc.notificationsRemoveAll()`);
  check('Alle entfernen: auch die letzte ist zurueckgenommen', m5.closed && ctx.notifier.shown.size === 0, `noch ${ctx.notifier.shown.size}`);

  // ---------- Seerr getrennt: alle des Profils gehen mit ----------
  await debug('request?id=1&status=5');
  await sync();
  const m6 = made.at(-1);
  check('Noch eine Mitteilung vor dem Trennen', made.length === 6 && !m6.closed);
  await ctx.run(`window.jc.seerrDisconnect().then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(600);
  check('Seerr getrennt: die Mitteilungen des Systems dieses Profils sind zurueckgenommen', m6.closed && ctx.notifier.shown.size === 0);
  await go('#/home', `!!document.querySelector('.home')`);
  m6.tap();
  await ctx.wait(1000);
  check('...und eine alte fuehrt nirgendwohin', (await ctx.run('location.hash')) === '#/home', await ctx.run('location.hash'));

  // ---------- Mitteilungen aus: kein Schalter fuer das System ----------
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(800);
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .setting')`);
  await waitFor(`!!(${systemToggle})`, 4000);
  check('Neu verbunden: Mitteilungen des Systems wieder aus (die Einstellungen gingen mit Seerr)', !(await toggleOn(systemToggle)));

  // ---------- Erlaubnis wie auf Android (nachgestellt: Stand und Anfrage der Attrappe vorgegeben; Windows selbst fragt nicht) ----------
  const realStatus = ctx.notifier.status;
  const realRequest = ctx.notifier.request;
  let perm = 'prompt';
  let asked = 0;
  ctx.notifier.status = () => ({ supported: true, permission: perm, settings: true });
  ctx.notifier.request = () => {
    asked++;
    if (perm === 'prompt') perm = 'denied'; // der Nutzer lehnt ab
    return ctx.notifier.status();
  };
  await go('#/home', `!!document.querySelector('.home')`);
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .setting')`);
  await waitFor(`!!(${systemToggle})`, 4000);
  check('Noch nicht gefragt: Schalter aus, kein Weg in die Einstellungen; gefragt wird nicht beim Oeffnen', !(await toggleOn(systemToggle)) && !/Windows-Einstellungen öffnen/.test(await panelText()) && asked === 0);
  await ctx.run(`${systemToggle}.click()`);
  const deniedShown = await waitFor(`/in den Systemeinstellungen ausgeschaltet/.test(document.querySelector('.settings-panel')?.textContent ?? '') && /Windows-Einstellungen öffnen/.test(document.querySelector('.settings-panel')?.textContent ?? '')`, 4000);
  check('Einschalten fragt einmal; abgelehnt: Schalter wieder aus, Hinweis und Weg in die Einstellungen; der Wunsch bleibt gemerkt', asked === 1 && deniedShown && !(await toggleOn(systemToggle)) && (await ctx.run(`window.jc.notifications().then((d) => d.preferences.system)`)) === true, `gefragt ${asked}`);
  await ctx.wait(500); // sonst zeigt die Aufnahme noch das Bild vor dem Klick
  await ctx.capture(path.join(out, 'SN-03-verweigert.png'));
  await ctx.run(`${systemToggle}.click()`);
  await ctx.wait(500);
  check('Verweigert und noch einmal eingeschaltet: keine zweite Frage, der Schalter springt zurueck', asked === 1 && !(await toggleOn(systemToggle)));
  perm = 'granted'; // in den Einstellungen des Systems erlaubt, zurueck in die App
  await ctx.run(`window.dispatchEvent(new Event('focus'))`);
  check('Erlaubnis nachtraeglich gegeben: ohne weiteren Schritt wieder ein, Hinweis weg', await waitFor(`(() => { const t = ${systemToggle}; return !!t && t.getAttribute('aria-checked') === 'true' && !/in den Systemeinstellungen ausgeschaltet/.test(document.querySelector('.settings-panel')?.textContent ?? ''); })()`, 4000) && asked === 1);
  ctx.notifier.status = realStatus;
  ctx.notifier.request = realRequest;
  const mainToggle = `[...document.querySelectorAll('.settings-panel .setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Mitteilungen').querySelector('.setting-control button, .setting-control input, .setting-control [role=switch]')`;
  await ctx.run(`${mainToggle}.click()`);
  check('Mitteilungen aus: kein Schalter fuer die Mitteilungen des Systems', await waitFor(`!(${systemToggle})`, 3000), JSON.stringify(await labels()));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
