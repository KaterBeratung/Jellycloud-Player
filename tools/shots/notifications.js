// Mitteilungen in der App (P17, nach NotificationsView, AppNotifications und NotificationCenterModel der Apple-App), Mock-Server mit Seerr auf Port 8985:
//  - ohne Seerr kein Eintrag im Profilmenue und kein Punkt; mit Seerr: erster Abgleich still, danach je Aenderung eine Mitteilung
//  - roter Punkt am Profilsymbol, "n neue" im Profilmenue, Uebersicht mit Karten (Plakat, Ueberschrift, Text, Stand, Zeit), Kontextmenue, "Alle gelesen",
//    "Alle entfernen", Antippen oeffnet den Titel; Einstellungen > Mitteilungen: aus = kein Abgleich und kein Punkt, wieder an = still; Verwalter: Neue Anfrage
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/notifications.js
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
  const PORT = 8985;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  ctx.win.setContentSize(1440, 900);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
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
  const input = (ev) => ctx.win.webContents.sendInputEvent(ev);
  const lists = () => state.log.filter((l) => l.at === 'seerr:GET /request').length;
  const dot = () => ctx.run(`(() => { const d = document.querySelector('.tool.who .notice-dot'); return { shown: !!d && !d.hidden && getComputedStyle(d).display !== 'none', label: document.querySelector('.tool.who').getAttribute('aria-label'), color: d ? getComputedStyle(d).backgroundColor : '' }; })()`);
  /** Profilmenue oeffnen und den Eintrag "Mitteilungen" lesen (null, wenn es keinen gibt); danach wieder zu. */
  const profileEntry = async ({ keepOpen = false } = {}) => {
    await ctx.run(`document.querySelector('.tool.who').click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 2000);
    const e = await ctx.run(`(() => { const b = [...document.querySelectorAll('.menu .menu-item')].find((x) => x.querySelector('.lbl')?.textContent === 'Mitteilungen'); return b ? { sub: b.querySelector('.sub')?.textContent ?? '', icon: !!b.querySelector('.check svg') } : null; })()`);
    if (!keepOpen) {
      input({ type: 'keyDown', keyCode: 'Escape' });
      await waitFor(`!document.querySelector('.menu')`, 1500);
    }
    return e;
  };
  const cards = () => ctx.run(`[...document.querySelectorAll('.notices-page .notice-card')].map((c) => ({ id: c.dataset.id, unread: c.classList.contains('unread'), dot: !!c.querySelector('.unread-dot'), title: c.querySelector('.notice-title').textContent.trim(), text: c.querySelector('.notice-message').textContent.trim(), tag: c.querySelector('.notice-meta .tag')?.textContent ?? '', time: c.querySelector('time')?.textContent ?? '', poster: !!c.querySelector('.notice-poster') }))`);
  const openOverview = async () => {
    await go('#/notifications', `!!document.querySelector('.notices-page')`);
    await ctx.wait(500);
  };

  // ---------- Ohne Seerr ----------
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  check('Ohne Seerr: kein Eintrag "Mitteilungen" im Profilmenue, kein Punkt', (await profileEntry()) === null && !(await dot()).shown);

  // ---------- Seerr verbunden: der erste Abgleich ist still ----------
  SEERR.permissions = 32; // anfragen, ohne Anfragen zu verwalten
  await debug('requests?count=3&open=3&by=1'); // drei eigene wartende Anfragen (TMDB 90001 bis 90003)
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  check('Verbindung bestaetigt: die App gleicht ab (Anlass ohne Zutun), und der erste Abgleich meldet nichts', (await waitFor(`true`, 10)) && (await (async () => { const end = Date.now() + 8000; while (Date.now() < end && lists() < 1) await ctx.wait(100); return lists() >= 1; })()) && (await ctx.run(`window.jc.notifications().then((d) => d.items.length === 0 && d.active)`)), `Abrufe ${lists()}`);
  const entry0 = await profileEntry();
  check('Mit Seerr: "Mitteilungen" im Profilmenue mit Glocke, ohne Zahl; kein Punkt', !!entry0 && entry0.sub === '' && entry0.icon && !(await dot()).shown, JSON.stringify(entry0));

  // ---------- Aenderungen bei Seerr: genau eine Mitteilung je Anfrage und Art ----------
  await debug('request?id=1&status=2'); // genehmigt (von einem Verwalter)
  await debug('request?id=2&status=5'); // geliefert
  await ctx.run(`window.jc.notificationsSync({ force: true })`);
  check('Roter Punkt am Profilsymbol (#FF453A), die Bezeichnung nennt die Zahl', await waitFor(`(() => { const d = document.querySelector('.tool.who .notice-dot'); return !!d && !d.hidden; })()`, 4000) && (await dot()).color === 'rgb(255, 69, 58)' && /2 neue/.test((await dot()).label), JSON.stringify(await dot()));
  const entry1 = await profileEntry({ keepOpen: true });
  check('Profilmenue: "Mitteilungen" mit "2 neue"', entry1?.sub === '2 neue', JSON.stringify(entry1));
  await ctx.wait(500); // das Menue blendet ein (sonst zeigt die Aufnahme noch das Bild davor)
  await ctx.capture(path.join(out, 'N-01-profilmenue.png'));
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((x) => x.querySelector('.lbl')?.textContent === 'Mitteilungen').click()`);
  check('Der Eintrag oeffnet die Uebersicht (eine Seite, kein Reiter)', await waitFor(`location.hash === '#/notifications' && !!document.querySelector('.notices-page .notice-card')`, 5000) && !(await ctx.run(`[...document.querySelectorAll('.nav-link')].some((a) => /Mitteilungen/.test(a.textContent))`)));
  await ctx.wait(600);
  const c1 = await cards();
  const byId = Object.fromEntries(c1.map((c) => [c.id, c]));
  check('Zwei Karten, je Anfrage und Art eine', c1.length === 2 && !!byId['seerr-1-approved'] && !!byId['seerr-2-available'], JSON.stringify(c1.map((c) => c.id)));
  check('Wortlaut wie die Apple-App: genehmigt und verfuegbar mit Titel', byId['seerr-1-approved']?.title === 'Anfrage genehmigt' && byId['seerr-1-approved']?.text === '„Anfrage 90001“ wurde genehmigt und wird jetzt beschafft.' && byId['seerr-2-available']?.title === 'Dein angefragter Film ist jetzt verfügbar' && /„Anfrage 90002“ wurde deiner Mediathek hinzugefügt/.test(byId['seerr-2-available']?.text ?? ''), JSON.stringify(c1));
  check('Je Karte: Plakat, Punkt fuer Ungelesenes, Stand als Tag, Zeit in Worten', c1.every((c) => c.poster && c.unread && c.dot && c.time) && byId['seerr-1-approved'].tag === 'Genehmigt' && byId['seerr-2-available'].tag === 'Verfügbar', JSON.stringify(c1));
  check('Ein weiterer Abgleich bringt keinen zweiten Eintrag', await (async () => { await ctx.run(`window.jc.notificationsSync({ force: true })`); await ctx.wait(300); return (await cards()).length === 2; })());
  await ctx.capture(path.join(out, 'N-02-uebersicht.png'));

  // Kontextmenue einer Karte (Rechtsklick am Mauszeiger): gelesen
  const box = await ctx.run(`(() => { const r = document.querySelector('.notice-card[data-id="seerr-1-approved"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  input({ type: 'mouseMove', x: box.x, y: box.y });
  input({ type: 'mouseDown', x: box.x, y: box.y, button: 'right', clickCount: 1 });
  input({ type: 'mouseUp', x: box.x, y: box.y, button: 'right', clickCount: 1 });
  await waitFor(`!!document.querySelector('.menu.open:not(.closing)')`, 2000);
  const menu1 = await ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item .lbl')].map((l) => l.textContent)`);
  check('Kontextmenue einer Mitteilung: Als gelesen markieren, Entfernen', JSON.stringify(menu1) === JSON.stringify(['Als gelesen markieren', 'Entfernen']), JSON.stringify(menu1));
  await ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item')].find((b) => b.textContent.includes('Als gelesen markieren')).click()`);
  check('Gelesen: die Karte ohne Punkt, am Profilsymbol "1 neue"', await waitFor(`!document.querySelector('.notice-card[data-id="seerr-1-approved"]').classList.contains('unread')`, 3000) && /1 neue/.test((await dot()).label));
  // Menue "Mehr": Alle gelesen
  await ctx.run(`document.querySelector('.notices-more').click()`);
  await waitFor(`!!document.querySelector('.menu.open:not(.closing)')`, 2000);
  const menu2 = await ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item')].map((b) => ({ l: b.querySelector('.lbl').textContent, danger: b.classList.contains('danger') }))`);
  check('Menue "Mehr": Alle gelesen, Alle entfernen (rot)', menu2.length === 2 && menu2[0].l === 'Alle gelesen' && menu2[1].l === 'Alle entfernen' && menu2[1].danger, JSON.stringify(menu2));
  await ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item')].find((b) => b.textContent.includes('Alle gelesen')).click()`);
  check('Alle gelesen: kein Punkt mehr, weder an den Karten noch am Profilsymbol', await waitFor(`!document.querySelector('.notice-card.unread')`, 3000) && (await waitFor(`document.querySelector('.tool.who .notice-dot').hidden`, 3000)));

  // Antippen oeffnet den Titel (nicht in der Mediathek: seine Seite bei Seerr), nie eine Wiedergabe
  await ctx.run(`document.querySelector('.notice-card[data-id="seerr-2-available"]').click()`);
  check('Antippen oeffnet den Titel (hier seine Seite bei Seerr)', await waitFor(`location.hash === '#/seerr/movie/90002' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Anfrage 90002'`, 6000), await ctx.run('location.hash'));
  await ctx.run(`history.back()`);
  await waitFor(`location.hash === '#/notifications' && !!document.querySelector('.notice-card')`, 5000);
  await ctx.wait(400);

  // Alle entfernen: leer, und nichts kommt beim naechsten Abgleich wieder
  await ctx.run(`document.querySelector('.notices-more').click()`);
  await waitFor(`!!document.querySelector('.menu.open:not(.closing)')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item')].find((b) => b.textContent.includes('Alle entfernen')).click()`);
  check('Alle entfernen: "Keine Mitteilungen" mit Hinweis, das Menue "Mehr" gesperrt, keine Fusszeile', await waitFor(`!document.querySelector('.notice-card') && /Keine Mitteilungen/.test(document.querySelector('.notices-page .page-status')?.textContent ?? '') && document.querySelector('.notices-more').disabled && document.querySelector('.notices-foot').hidden`, 3000));
  await ctx.run(`window.jc.notificationsSync({ force: true })`);
  await ctx.wait(300);
  check('...der naechste Abgleich bringt die entfernten nicht wieder', (await cards()).length === 0);
  await ctx.capture(path.join(out, 'N-03-leer.png'));

  // ---------- Einstellungen > Mitteilungen ----------
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .toggle, .settings-panel [role=switch], .settings-panel input[type=checkbox]')`);
  await ctx.wait(400);
  const labels = () => ctx.run(`[...document.querySelectorAll('.settings-panel .setting-label')].map((l) => l.textContent)`);
  const l1 = await labels();
  check('Einstellungen: Hauptschalter und die Arten; "Neue Anfragen" nur fuer Konten, die alle Anfragen sehen', JSON.stringify(l1) === JSON.stringify(['Mitteilungen', 'Verfügbar', 'Erste Folgen verfügbar', 'Genehmigt', 'Abgelehnt', 'Fehlgeschlagen']), JSON.stringify(l1));
  check('...der Bereich steht in der Liste der Einstellungen', await ctx.run(`[...document.querySelectorAll('.settings-nav a, .settings-nav button')].some((a) => /Mitteilungen/.test(a.textContent))`));
  await ctx.capture(path.join(out, 'N-04-einstellungen.png'));
  const mainToggle = `[...document.querySelectorAll('.settings-panel .setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Mitteilungen').querySelector('.setting-control button, .setting-control input, .setting-control [role=switch]')`;
  await ctx.run(`${mainToggle}.click()`);
  check('Ausschalten: die Arten verschwinden, der Hinweis sagt, was aus heisst', await waitFor(`(() => { const l = [...document.querySelectorAll('.settings-panel .setting-label')].map((x) => x.textContent); return l.length === 1 && /Ausgeschaltet fragt die App Seerr nicht/.test(document.querySelector('.settings-panel').textContent); })()`, 3000));
  // In der ausgeschalteten Zeit: abgelehnt
  await debug('request?id=3&status=3');
  const beforeOff = lists();
  await openOverview();
  await ctx.wait(500);
  check('Ausgeschaltet: die Uebersicht gleicht nicht ab (keine Abfrage bei Seerr) und sagt, dass Mitteilungen aus sind', lists() === beforeOff && /Mitteilungen sind ausgeschaltet/.test(await ctx.run(`document.querySelector('.notices-page .page-status')?.textContent ?? ''`)), `Abrufe ${beforeOff} -> ${lists()}`);
  check('...und kein Punkt am Profilsymbol', !(await dot()).shown);
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .setting')`);
  await ctx.wait(300);
  await ctx.run(`${mainToggle}.click()`);
  await waitFor(`[...document.querySelectorAll('.settings-panel .setting-label')].length > 1`, 3000);
  await openOverview();
  await ctx.wait(800);
  check('Wieder eingeschaltet: der erste Abgleich ist still (die Ablehnung aus der ausgeschalteten Zeit kommt nicht nach)', lists() > beforeOff && (await cards()).length === 0, `Abrufe ${lists()}`);
  await debug('request?id=3&status=5');
  await ctx.run(`window.jc.notificationsSync({ force: true })`);
  check('...danach kommt Neues wie gewohnt', await waitFor(`!!document.querySelector('.notice-card[data-id="seerr-3-available"]')`, 4000));

  // ---------- Verwalter: neue Anfragen anderer ----------
  SEERR.permissions = 16 | 32;
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`); // neue Pruefung: Rechte des Benutzers
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(1500);
  await ctx.run(`window.jc.notificationsSync({ force: true })`); // Ausgangsstand mit der Liste aller
  await debug('requests?count=1&open=1&by=3');
  SEERR.requests.at(-1).createdAt = new Date().toISOString(); // eben erst gestellt (die Zeitstempel des Testservers liegen sonst in der Vergangenheit)
  await ctx.run(`window.jc.notificationsSync({ force: true })`);
  await openOverview();
  const c3 = await cards();
  const fresh = c3.find((c) => /newRequest$/.test(c.id));
  check('Verwalter: "Neue Anfrage" mit dem Namen dessen, der angefragt hat, Stand "Angefragt"', !!fresh && fresh.title === 'Neue Anfrage' && fresh.text === 'ben hat „Anfrage 90004“ angefragt.' && fresh.tag === 'Angefragt', JSON.stringify(c3));
  await go('#/settings/notifications', `!!document.querySelector('.settings-panel .setting')`);
  await ctx.wait(400);
  check('...und in den Einstellungen die Art "Neue Anfragen"', (await labels()).includes('Neue Anfragen'), JSON.stringify(await labels()));

  // ---------- Seerr getrennt: Mitteilungen und Einstellungen gehen mit ----------
  await ctx.run(`window.jc.seerrDisconnect().then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(800);
  check('Seerr getrennt: kein Eintrag im Profilmenue, kein Punkt', (await profileEntry()) === null && !(await dot()).shown);
  await openOverview();
  check('...die Uebersicht sagt, dass es Mitteilungen nur mit Seerr gibt', /Verbinde Seerr/.test(await ctx.run(`document.querySelector('.notices-page .page-status')?.textContent ?? ''`)));
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await ctx.wait(800);
  check('...neu verbunden: keine alten Mitteilungen mehr', await ctx.run(`window.jc.notifications().then((d) => d.active && d.items.length === 0)`));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
