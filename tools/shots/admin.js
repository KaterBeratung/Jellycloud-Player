// Verwaltung fuer Administratoren (JC_DEV=1, JC_FAKE_MPV=1), gegen den Mock-Server: Rechte, Server, Aufgaben, Aktivitaet, Benutzer, Eintraege bearbeiten/identifizieren/loeschen, Dialoge.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/admin.js
const path = require('node:path');
const { server, items, state, setAdmin } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  const relogin = async () => {
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(2200);
  };
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const go = async (hash) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await ctx.wait(500);
  };
  const press = (key) => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
  const text = (sel) => ctx.run(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
  const click = (sel) => ctx.run(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  const clickByText = (sel, re) => ctx.run(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => ${re}.test(b.textContent))?.click()`);
  const dialogTitle = () => ctx.run(`document.querySelector('.mdl-scrim:not(.closing) .mdl-title')?.textContent ?? ''`);
  const dialogButtons = () => ctx.run(`[...document.querySelectorAll('.mdl-scrim:not(.closing) .mdl-actions button')].map((b) => b.textContent.trim())`);
  const clickDialog = (re) => ctx.run(`[...document.querySelectorAll('.mdl-scrim:not(.closing) .mdl-actions button')].find((b) => ${re}.test(b.textContent))?.click()`);
  const noDialog = async () => {
    await ctx.wait(350);
    return ctx.run(`!document.querySelector('.mdl-scrim')`);
  };
  const clickMenu = (re) => ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => ${re}.test(b.textContent))?.click()`);
  const menuText = () => ctx.run(`[...document.querySelectorAll('.menu')].at(-1)?.innerText ?? ''`);
  const toastText = () => ctx.run(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ')`);
  const logHas = (re) => state.log.some((l) => re.test(l.at));

  const paper = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const neon = [...items.values()].find((i) => i.Name === 'Neon Harbor');
  const episode = [...items.values()].find((i) => i.Type === 'Episode');

  // ---------- 1. Ohne Administratorrechte: es gibt nichts davon ----------
  setAdmin(false);
  await relogin();
  check('Kein Administrator: kein Verwaltungsknopf in der Kopfzeile', await ctx.run(`!document.querySelector('.tool[href="#/admin"]')`));
  await go('#/admin');
  check('Kein Administrator: die Adresse #/admin zeigt nur den Hinweis "Nur für Administratoren", keine Verwaltung', await waitFor(`/Nur für Administratoren/.test(document.querySelector('.admin')?.innerText ?? '')`, 4000) && (await ctx.run(`!document.querySelector('.admin .btn, .admin-task, .admin-user')`)));
  await go(`#/item/${paper.Id}`);
  await waitFor(`!!document.querySelector('.detail-actions button[title="Mehr"]')`, 10000);
  await click('.detail-actions button[title="Mehr"]');
  await waitFor(`!!document.querySelector('.menu')`, 3000);
  check('Kein Administrator: das Menue "Mehr" hat keinen Abschnitt "Verwalten"', await ctx.run(`![...document.querySelectorAll('.menu .menu-head')].some((h) => /Verwalten/.test(h.textContent)) && ![...document.querySelectorAll('.menu .menu-item')].some((b) => /Metadaten bearbeiten|Vom Server löschen/.test(b.textContent))`));
  await press('Escape');
  await ctx.wait(300);

  // ---------- 2. Administrator: Knopf und Server ----------
  setAdmin(true);
  await relogin();
  await go('#/home');
  check('Administrator: Verwaltungsknopf (Schild) in der Kopfzeile, vor den Einstellungen', await ctx.run(`(() => { const t = [...document.querySelectorAll('.toolpill .tool')]; const i = t.findIndex((x) => x.getAttribute('href') === '#/admin'); return i === 2 && t[3].getAttribute('href') === '#/settings'; })()`));
  check('Die Kopfzeile bleibt in Ordnung: fuenf gleich grosse runde Scheiben in der Kapsel', await ctx.run(`(() => { const p = document.querySelector('.toolpill'); const d = [...p.children].map((c) => Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)); return p.children.length === 5 && new Set(d).size === 1 && Math.round(p.getBoundingClientRect().height) === 44; })()`));
  await click('.tool[href="#/admin"]');
  check('Klick auf das Schild oeffnet die Verwaltung (Server)', await waitFor(`location.hash === '#/admin' && /Mock Jellyfin/.test(document.querySelector('.admin')?.innerText ?? '')`, 6000));
  const srv = await text('.admin');
  check('Server: Name, Version, Betriebssystem, Adresse stehen da', /Mock Jellyfin/.test(srv) && /Jellyfin Server 10\.10\.3/.test(srv) && /Windows 11/.test(srv) && /127\.0\.0\.1:8097/.test(srv), srv.replace(/\s+/g, ' ').slice(0, 160));
  check('Seitenleiste: Server, Aufgaben, Aktivität, Benutzer; Server ist aktiv', await ctx.run(`[...document.querySelectorAll('.admin .snav')].map((a) => a.textContent.trim() + (a.classList.contains('on') ? '*' : '')).join('|') === 'Server*|Aufgaben|Aktivität|Benutzer'`));
  check('Das Schild in der Kopfzeile ist als aktiv markiert', await ctx.run(`document.querySelector('.tool[href="#/admin"]').classList.contains('on')`));
  await ctx.capture(path.join(out, 'A-01-server.png'));

  await clickByText('.admin .btn', '/Jetzt durchsuchen/');
  await ctx.wait(700);
  check('Bibliotheken durchsuchen: eine Anfrage an den Server und eine Meldung', state.adminData.refreshes === 1 && /durchsucht/.test(await toastText()), `${state.adminData.refreshes}: ${await toastText()}`);

  // Neu starten: doppelte Rueckfrage
  await clickByText('.admin .btn.danger', '/Neu starten/');
  check('Neu starten: erst eine Rueckfrage ("Server neu starten?")', (await dialogTitle()) === 'Server neu starten?', await dialogTitle());
  await ctx.wait(200);
  check('Rueckfrage: Abbrechen hat den Fokus (gefaehrliche Aktion), der rote Knopf bestaetigt', (await ctx.run(`document.activeElement?.textContent.trim()`)) === 'Abbrechen' && (await ctx.run(`!!document.querySelector('.mdl-actions .btn.danger')`)));
  check('Rueckfrage: der Fokus bleibt im Dialog (Tab springt im Kreis)', await (async () => { await press('Tab'); await press('Tab'); await press('Tab'); return ctx.run(`!!document.activeElement?.closest('.mdl')`); })());
  await press('Escape');
  check('Escape bricht ab: nichts wurde neu gestartet, der Fokus ist zurueck beim Knopf', (await noDialog()) && state.adminData.restarts === 0 && (await ctx.run(`/Neu starten/.test(document.activeElement?.textContent ?? '')`)));
  await clickByText('.admin .btn.danger', '/Neu starten/');
  await clickDialog('/Ja, neu starten/');
  await ctx.wait(500);
  check('Neu starten: nach der ersten Bestaetigung kommt eine zweite ("Letzte Rueckfrage") mit dem Servernamen', (await dialogTitle()) === 'Letzte Rückfrage' && /Mock Jellyfin/.test(await text('.mdl-scrim:not(.closing) .mdl-text')), `${await dialogTitle()}`);
  await clickDialog('/Abbrechen/');
  check('Zweite Rueckfrage abgebrochen: nichts wurde neu gestartet', (await noDialog()) && state.adminData.restarts === 0);
  await clickByText('.admin .btn.danger', '/Neu starten/');
  await clickDialog('/Ja, neu starten/');
  await ctx.wait(500);
  await clickDialog('/Ja, neu starten/');
  await ctx.wait(700);
  check('Neu starten nach zwei Bestaetigungen: genau eine Anfrage, Meldung "startet neu"', state.adminData.restarts === 1 && /startet neu/.test(await toastText()), `${state.adminData.restarts}`);

  // Herunterfahren: ebenfalls doppelt
  await clickByText('.admin .btn.danger', '/Herunterfahren/');
  check('Herunterfahren: Rueckfrage "Server herunterfahren?"', (await dialogTitle()) === 'Server herunterfahren?');
  await clickDialog('/Ja, herunterfahren/');
  await ctx.wait(500);
  check('Herunterfahren: zweite Rueckfrage', (await dialogTitle()) === 'Letzte Rückfrage');
  await ctx.capture(path.join(out, 'A-02-rueckfrage.png'));
  await clickDialog('/Ja, herunterfahren/');
  await ctx.wait(700);
  check('Herunterfahren nach zwei Bestaetigungen: genau eine Anfrage', state.adminData.shutdowns === 1 && /herunter/.test(await toastText()), `${state.adminData.shutdowns}`);

  // ---------- 3. Aufgaben ----------
  await go('#/admin/tasks');
  check('Aufgaben: vier Aufgaben in Gruppen nach Kategorie', await waitFor(`document.querySelectorAll('.admin-task').length === 4`, 5000) && (await ctx.run(`document.querySelectorAll('.admin .group-title').length === 3`)));
  const t1 = await text('.admin');
  check('Aufgaben: Zustand lesbar ("Läuft (43 %)", "Zuletzt …: abgeschlossen/fehlgeschlagen", "Noch nie gelaufen")', /Läuft \(43 %\)/.test(t1) && /abgeschlossen/.test(t1) && /fehlgeschlagen/.test(t1) && /Noch nie gelaufen/.test(t1), t1.replace(/\s+/g, ' ').slice(0, 200));
  check('Aufgaben: laufende Aufgabe zeigt einen Fortschrittsbalken und "Stoppen", die anderen "Starten"', await ctx.run(`document.querySelectorAll('.admin-bar').length === 1 && [...document.querySelectorAll('.admin-task .btn')].map((b) => b.textContent.trim()).sort().join('|') === 'Starten|Starten|Starten|Stoppen'`));
  check('Aufgaben: die fehlgeschlagene ist rot markiert', await ctx.run(`document.querySelectorAll('.admin-task.failed').length === 1`));
  await ctx.capture(path.join(out, 'A-03-aufgaben.png'));
  const scanTask = state.adminData.tasks.find((x) => /durchsuchen/.test(x.Name));
  await ctx.run(`document.querySelector('[data-task="${scanTask.Id}"]').click()`);
  check('Aufgabe starten: der Server meldet "Running", die Ansicht zeigt "Stoppen"', await waitFor(`/Stoppen/.test(document.querySelector('[data-task="${scanTask.Id}"]')?.textContent ?? '')`, 4000) && scanTask.State === 'Running', scanTask.State);
  await ctx.run(`document.querySelector('[data-task="${scanTask.Id}"]').click()`);
  check('Aufgabe stoppen: wieder "Starten"', await waitFor(`/Starten/.test(document.querySelector('[data-task="${scanTask.Id}"]')?.textContent ?? '')`, 4000) && scanTask.State === 'Idle');
  state.adminData.tasks.find((x) => /Cache/.test(x.Name)).State = 'Running';
  state.adminData.tasks.find((x) => /Cache/.test(x.Name)).CurrentProgressPercentage = 77;
  check('Aufgaben aktualisieren sich von selbst (Fortschritt einer neu gestarteten Aufgabe nach wenigen Sekunden)', await waitFor(`/Läuft \\(77 %\\)/.test(document.querySelector('.admin')?.innerText ?? '')`, 9000));

  // ---------- 4. Aktivitaet ----------
  await go('#/admin/sessions');
  check('Aktivitaet: drei Sitzungen und vier Protokolleintraege', await waitFor(`document.querySelectorAll('.admin-session').length === 3 && document.querySelectorAll('.admin-log').length === 4`, 5000));
  const t2 = await text('.admin');
  check('Sitzung: wer schaut was ("lena", "Neon Harbor", Position 25:00 von 1:40:00), Geraet und Programm', /lena/.test(t2) && /Neon Harbor \(25:00 \/ 1:40:00\)/.test(t2) && /Jellyfin Web · Wohnzimmer-TV/.test(t2), t2.replace(/\s+/g, ' ').slice(0, 220));
  check('Sitzung ohne Wiedergabe: "Schaut gerade nichts"; die schauende ist markiert', /Schaut gerade nichts/.test(t2) && (await ctx.run(`document.querySelectorAll('.admin-session.playing').length === 1`)));
  check('Protokoll: Fehler rot, Warnung gelb', await ctx.run(`document.querySelectorAll('.admin-log.sev-error').length === 1 && document.querySelectorAll('.admin-log.sev-warning').length === 1`));
  check('Zeitangaben relativ ("vor 3 Stunden", "gestern")', /vor 3 Stunden/.test(t2) && /gestern/.test(t2), t2.replace(/\s+/g, ' ').match(/vor \d+ \w+|gestern|gerade eben/g)?.join(', '));
  state.adminData.sessions.push({ Id: 'sess-9', UserId: 'x', UserName: 'neu-dazu', Client: 'Test', DeviceName: 'Handy', LastActivityDate: new Date().toISOString(), NowPlayingItem: null, PlayState: {} });
  check('Aktivitaet aktualisiert sich von selbst (neue Sitzung erscheint)', await waitFor(`document.querySelectorAll('.admin-session').length === 4`, 9000));
  await ctx.capture(path.join(out, 'A-04-aktivitaet.png'));

  // ---------- 5. Benutzer ----------
  await go('#/admin/users');
  check('Benutzer: drei Benutzer mit Kennzeichen (Administrator, Du, Gesperrt, Ohne Passwort)', await waitFor(`document.querySelectorAll('.admin-user').length === 3`, 5000) && (await ctx.run(`(() => { const u = (n) => document.querySelector('[data-user="' + n + '"]')?.innerText ?? ''; return /Administrator/.test(u('demo')) && /Du/.test(u('demo')) && /Gesperrt/.test(u('max')) && /Ohne Passwort/.test(u('max')) && !/Gesperrt|Administrator/.test(u('lena')); })()`)));
  check('Das eigene Konto hat kein Menue (nicht sperren, nicht loeschen)', await ctx.run(`document.querySelector('[data-user="demo"] button') === null`));
  await ctx.capture(path.join(out, 'A-05-benutzer.png'));
  // Anlegen
  await clickByText('.admin .btn', '/Benutzer anlegen/');
  await ctx.wait(200);
  check('Benutzer anlegen: Dialog mit Name und Passwort, Fokus im Namensfeld', (await dialogTitle()) === 'Benutzer anlegen' && (await ctx.run(`document.activeElement?.getAttribute('aria-label')`)) === 'Benutzername');
  await clickDialog('/^Anlegen$/');
  check('Leerer Name: Fehlermeldung im Dialog, nichts angelegt', (await waitFor(`!!document.querySelector('.mdl-error:not([hidden])')`, 1500)) && state.adminData.users.length === 3, await text('.mdl-error'));
  await ctx.run(`(() => { const i = document.querySelector('.mdl input[type=text]'); i.value = 'tester'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.run(`(() => { const i = document.querySelector('.mdl input[type=password]'); i.value = 'geheim123'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await clickDialog('/^Anlegen$/');
  check('Benutzer angelegt: Meldung, Dialog zu, Liste hat vier Eintraege', (await noDialog()) && (await waitFor(`document.querySelectorAll('.admin-user').length === 4`, 4000)) && /tester/.test(await toastText()));
  check('Beim Anlegen steht das Passwort nicht im Protokoll des Servers (nur "hat Passwort")', !JSON.stringify(state.log).includes('geheim123') && state.log.find((l) => l.at === 'admin POST /Users/New')?.hasPassword === true);
  // Sperren
  await ctx.run(`document.querySelector('[data-user="lena"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  check('Menue eines Benutzers: Sperren, Passwort zuruecksetzen, Passwort setzen, Loeschen', (await ctx.run(`[...document.querySelectorAll('.menu .menu-item .lbl')].map((l) => l.textContent.trim()).join('|')`)) === 'Sperren|Passwort zurücksetzen…|Neues Passwort setzen…|Löschen…');
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /^Sperren/.test(b.textContent.trim())).click()`);
  check('Sperren: "Gesperrt" erscheint, die Richtlinie ging komplett zum Server', await waitFor(`/Gesperrt/.test(document.querySelector('[data-user="lena"]')?.innerText ?? '')`, 4000) && state.log.some((l) => l.at.startsWith('admin POST /Users/') && l.isDisabled === true && l.keepsOtherFields === true));
  await ctx.run(`document.querySelector('[data-user="lena"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  check('Gesperrter Benutzer: das Menue bietet "Entsperren"', /Entsperren/.test(await menuText()));
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /^Entsperren/.test(b.textContent.trim())).click()`);
  check('Entsperren: die Kennzeichnung verschwindet', await waitFor(`!/Gesperrt/.test(document.querySelector('[data-user="lena"]')?.innerText ?? '')`, 4000));
  await ctx.run(`document.querySelector('[data-user="tester"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  await ctx.run(`document.activeElement?.blur?.()`);
  await press('Escape');
  await ctx.wait(300);
  // Administratoren: kein "Sperren"
  state.adminData.users.find((u) => u.Name === 'tester').Policy.IsAdministrator = true;
  await go('#/admin/sessions');
  await go('#/admin/users');
  await waitFor(`document.querySelectorAll('.admin-user').length === 4`, 4000);
  await ctx.run(`document.querySelector('[data-user="tester"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  check('Anderer Administrator: das Menue bietet kein "Sperren"', !/Sperren/.test(await menuText()) && /Löschen/.test(await menuText()));
  await press('Escape');
  await ctx.wait(300);
  state.adminData.users.find((u) => u.Name === 'tester').Policy.IsAdministrator = false;
  // Passwort
  await go('#/admin/sessions');
  await go('#/admin/users');
  await waitFor(`document.querySelectorAll('.admin-user').length === 4`, 4000);
  await ctx.run(`document.querySelector('[data-user="lena"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /zurücksetzen/.test(b.textContent)).click()`);
  check('Passwort zuruecksetzen: Rueckfrage mit dem Namen', (await waitFor(`!!document.querySelector('.mdl')`, 2000)) && /lena/.test(await dialogTitle()), await dialogTitle());
  await clickDialog('/^Zurücksetzen$/');
  check('Passwort zurueckgesetzt: der Server hat es geleert, Meldung', (await waitFor(`/Ohne Passwort/.test(document.querySelector('[data-user="lena"]')?.innerText ?? '')`, 4000)) && /zurückgesetzt/.test(await toastText()));
  await ctx.run(`document.querySelector('[data-user="lena"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /Neues Passwort/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl input[type=password]')`, 2000);
  await clickDialog('/Passwort setzen/');
  check('Neues Passwort leer: Fehlermeldung, nichts gesetzt', (await waitFor(`!!document.querySelector('.mdl-error:not([hidden])')`, 1500)) && /fehlt/.test(await text('.mdl-error')));
  await ctx.run(`(() => { const i = document.querySelector('.mdl input[type=password]'); i.value = 'neu-und-geheim'; })()`);
  await clickDialog('/Passwort setzen/');
  check('Neues Passwort gesetzt: Kennzeichnung "Ohne Passwort" weg, nirgends im Protokoll', (await waitFor(`!/Ohne Passwort/.test(document.querySelector('[data-user="lena"]')?.innerText ?? '')`, 4000)) && !JSON.stringify(state.log).includes('neu-und-geheim'));
  // Loeschen
  await ctx.run(`document.querySelector('[data-user="max"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /Löschen/.test(b.textContent)).click()`);
  await ctx.wait(200);
  check('Benutzer loeschen: rote Rueckfrage mit Namen, Abbrechen hat den Fokus', (await waitFor(`!!document.querySelector('.mdl')`, 2000)) && /max/.test(await dialogTitle()) && (await ctx.run(`document.activeElement?.textContent.trim()`)) === 'Abbrechen');
  await clickDialog('/Abbrechen/');
  check('Abgebrochen: der Benutzer ist noch da', (await noDialog()) && state.adminData.users.some((u) => u.Name === 'max'));
  await ctx.run(`document.querySelector('[data-user="max"] button').click()`);
  await waitFor(`!!document.querySelector('.menu')`, 2000);
  await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /Löschen/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl')`, 2000);
  await clickDialog('/^Löschen$/');
  check('Bestaetigt: der Benutzer ist weg (Server und Liste)', (await waitFor(`!document.querySelector('[data-user="max"]')`, 4000)) && !state.adminData.users.some((u) => u.Name === 'max'));

  // ---------- 6. Eintraege verwalten ----------
  await go(`#/item/${paper.Id}`);
  await waitFor(`!!document.querySelector('.detail-actions button[title="Mehr"]')`, 10000);
  await ctx.wait(500);
  const openMore = async () => {
    await click('.detail-actions button[title="Mehr"]');
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(250);
  };
  await openMore();
  const entries = await ctx.run(`[...document.querySelector('.menu').children].map((c) => c.classList.contains('menu-head') ? '[' + c.textContent.trim() + ']' : c.querySelector('.lbl').textContent.trim())`);
  check('Administrator: "Mehr" hat den Abschnitt "Verwalten" mit Bearbeiten, Identifizieren, Loeschen', entries.join('|').endsWith('[Verwalten]|Metadaten bearbeiten…|Identifizieren…|Vom Server löschen…'), entries.join('|'));
  await ctx.capture(path.join(out, 'A-06-mehr-menue.png'));
  // Bearbeiten
  await clickMenu('/Metadaten bearbeiten/');
  check('Bearbeiten: Fenster mit den aktuellen Werten (Titel, Jahr, Beschreibung, Genres)', (await waitFor(`!!document.querySelector('.mdl .field')`, 3000)) && (await ctx.run(`(() => { const v = [...document.querySelectorAll('.mdl .field')].map((f) => f.value); return v[0] === 'Paper Moons' && v.includes('2021') && v.some((x) => x.startsWith('A tense')) && v.includes('Romance, Drama'); })()`)));
  await ctx.capture(path.join(out, 'A-07-bearbeiten.png'));
  await clickDialog('/Speichern/');
  check('Nichts geaendert: keine Anfrage an den Server, Hinweis "Nichts geändert"', (await noDialog()) && !logHas(/^admin POST \/Items\/[0-9a-f]+$/) && /Nichts geändert/.test(await toastText()));
  await openMore();
  await clickMenu('/Metadaten bearbeiten/');
  await waitFor(`!!document.querySelector('.mdl .field')`, 3000);
  await ctx.run(`(() => { const f = [...document.querySelectorAll('.mdl .field')]; f[0].value = 'Papiermonde'; f[3].value = 'Ein Slogan'; const y = document.querySelector('.mdl input[type=number]'); y.value = '2020'; const g = f.find((x) => x.value === 'Romance, Drama'); g.value = 'Drama, Romanze, Drama'; })()`);
  await clickDialog('/Speichern/');
  await ctx.wait(1200);
  const saved = items.get(paper.Id);
  check('Gespeichert: der Server hat Titel, Jahr, Slogan und Genres (ohne Doppelte), und die Besetzung ging mit', saved.Name === 'Papiermonde' && saved.ProductionYear === 2020 && saved.Taglines?.[0] === 'Ein Slogan' && JSON.stringify(saved.Genres) === JSON.stringify(['Drama', 'Romanze']) && state.log.some((l) => l.keepsPeople === true), JSON.stringify([saved.Name, saved.ProductionYear, saved.Taglines, saved.Genres]));
  check('Gespeichert: die Seite laedt neu und zeigt den neuen Titel', await waitFor(`document.querySelector('.detail-title')?.textContent.trim() === 'Papiermonde'`, 6000));
  // Identifizieren
  await openMore();
  await clickMenu('/Identifizieren/');
  check('Identifizieren: Fenster mit Suchfeld (Titel und Jahr vorbelegt)', (await waitFor(`!!document.querySelector('.mdl-search')`, 3000)) && (await ctx.run(`document.querySelector('.mdl-search .field').value === 'Papiermonde' && document.querySelector('.mdl-search .year').value === '2020'`)));
  await click('.mdl-search .btn');
  check('Suche: zwei Treffer mit Namen, Jahr und Quelle', (await waitFor(`document.querySelectorAll('.mdl-result').length === 2`, 5000)) && /Mock Treffer Eins/.test(await text('.mdl-results')) && /TheMovieDb/i.test(await text('.mdl-results')));
  await ctx.capture(path.join(out, 'A-08-identifizieren.png'));
  await click('.mdl-result:nth-child(2)');
  check('Treffer angeklickt: erst eine Rueckfrage ("übernehmen?")', (await waitFor(`/übernehmen/.test(document.querySelectorAll('.mdl-scrim .mdl-title')[1]?.textContent ?? '')`, 3000)));
  await ctx.run(`[...document.querySelectorAll('.mdl-scrim')].at(-1).querySelector('.btn.danger').click()`);
  await ctx.wait(1000);
  check('Treffer uebernommen: der Server hat ihn bekommen (Bilder ersetzen), Fenster zu', items.get(paper.Id).Name === 'Mock Treffer Zwei' && state.log.some((l) => /RemoteSearch\/Apply/.test(l.at) && l.query?.replaceAllImages === 'true') && (await noDialog()));
  items.get(paper.Id).Name = 'Paper Moons';
  // Folgen: kein Identifizieren
  await go(`#/item/${episode.Id}`);
  await waitFor(`!!document.querySelector('.detail-actions button[title="Mehr"]')`, 10000);
  await ctx.wait(500);
  await openMore();
  const epEntries = await ctx.run(`[...document.querySelectorAll('.menu .menu-item .lbl')].map((l) => l.textContent.trim())`);
  check('Folge: Bearbeiten und Loeschen, aber kein Identifizieren (nur Filme und Serien)', epEntries.includes('Metadaten bearbeiten…') && epEntries.includes('Vom Server löschen…') && !epEntries.includes('Identifizieren…'), JSON.stringify(epEntries));
  await press('Escape');
  await ctx.wait(300);
  // Loeschen
  await go(`#/item/${neon.Id}`);
  await waitFor(`!!document.querySelector('.detail-actions button[title="Mehr"]')`, 10000);
  await ctx.wait(500);
  await openMore();
  await clickMenu('/Vom Server löschen/');
  await ctx.wait(200);
  check('Loeschen: rote Rueckfrage mit dem Titel, Abbrechen hat den Fokus', (await waitFor(`!!document.querySelector('.mdl')`, 3000)) && /Neon Harbor/.test(await dialogTitle()) && (await ctx.run(`document.activeElement?.textContent.trim()`)) === 'Abbrechen');
  await ctx.capture(path.join(out, 'A-09-loeschen.png'));
  await clickDialog('/Abbrechen/');
  check('Abgebrochen: der Eintrag ist noch auf dem Server', (await noDialog()) && items.has(neon.Id) && state.adminData.deleted.length === 0);
  await openMore();
  await clickMenu('/Vom Server löschen/');
  await waitFor(`!!document.querySelector('.mdl')`, 3000);
  await clickDialog('/^Löschen$/');
  await ctx.wait(1200);
  check('Bestaetigt: der Server hat den Eintrag geloescht, die App geht zur Startseite', !items.has(neon.Id) && state.adminData.deleted.includes(neon.Id) && (await ctx.run(`location.hash === '#/home'`)));

  // ---------- 7. Rechte entzogen: der Server lehnt ab, die Oberflaeche sagt es ----------
  setAdmin(false);
  await go('#/admin/users');
  check('Rechte inzwischen entzogen (Server antwortet 403): "Nur für Administratoren" statt einer Liste', await waitFor(`/Nur für Administratoren/.test(document.querySelector('.admin')?.innerText ?? '')`, 4000));
  await ctx.capture(path.join(out, 'A-10-403.png'));
  await go('#/admin/server');
  check('Dasselbe beim Server-Bereich', await waitFor(`/Nur für Administratoren/.test(document.querySelector('.admin')?.innerText ?? '')`, 4000));

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
