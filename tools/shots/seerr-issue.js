// Problem an Seerr melden (Detailseite > Mehr > Problem melden): Art (Video, Audio, Untertitel, Sonstiges), Kommentar freiwillig, Staffel und Folge bei Serien,
// Fehler im Fenster (JC_DEV=1). Nutzt den Mock-Server mit Mock-Seerr (eigener Port 8897).
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr-issue.js
const path = require('node:path');
const { server, items, SEERR, state } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const PORT = 8897;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(400);
  ctx.win.setContentSize(1440, 900);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const waitFor = async (js, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const connectSeerr = async () => {
    await ctx.run(`window.jc.seerrConnect({ url: 'http://127.0.0.1:${PORT}', mode: 'apikey', apiKey: ${JSON.stringify(SEERR.apiKey)} }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
    await ctx.wait(1800);
  };
  const openItem = async (item) => {
    await ctx.run(`location.hash = '#/item/${item.Id}'`);
    return waitFor(`!!document.querySelector('.detail .detail-actions, .detail-actions') && [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Mehr')`, 8000);
  };
  const openMenu = async () => {
    await ctx.run(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Mehr').click()`);
    await ctx.wait(500);
  };
  const menuLabels = () => ctx.run(`[...document.querySelectorAll('.menu .menu-item .lbl')].map((e) => e.textContent.trim())`);
  const closeMenuKey = () => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const modal = () => ctx.run(`!!document.querySelector('.mdl-scrim:not(.closing)')`);
  const pickType = (key) => ctx.run(`document.querySelector('.issue-type[data-type="${key}"]').click()`);
  const sendBtn = () => `[...document.querySelectorAll('.mdl-actions .btn')].find((b) => b.textContent.trim() === 'Melden')`;
  const lastIssue = () => SEERR.issues[SEERR.issues.length - 1];
  const toasts = () => ctx.run(`[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')`);

  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  const episode = [...items.values()].find((i) => i.Type === 'Episode' && i.SeriesId === show.Id && i.ParentIndexNumber === 1 && i.IndexNumber === 2);
  const other = [...items.values()].find((i) => i.Type === 'Movie' && i.Id !== movie.Id && !i.ProviderIds?.Tmdb);
  const unknown = [...items.values()].find((i) => i.Type === 'Movie' && i.Id !== movie.Id && i.Id !== other.Id);
  unknown.ProviderIds = { Tmdb: '603' }; // Seerr kennt 603 nicht (keine Medien-Nummer)

  // ---------- Ohne Seerr: kein Eintrag ----------
  await openItem(movie);
  await openMenu();
  check('Ohne Seerr-Verbindung gibt es im Menue "Mehr" keinen Eintrag "Problem melden"', !(await menuLabels()).some((l) => /Problem melden/.test(l)), (await menuLabels()).join(' | '));
  await closeMenuKey();
  check('Ohne Seerr-Verbindung gibt es auch das Warnschild in der Leiste nicht', !(await ctx.run(`!!document.querySelector('.detail-actions [data-action="issue"]')`)));

  await connectSeerr();

  // ---------- Film ----------
  await openItem(movie);
  const direct = await ctx.run(`(() => { const b = document.querySelector('.detail-actions [data-action="issue"]'); if (!b) return null; const bar = [...b.parentElement.children]; return { label: b.getAttribute('aria-label'), title: b.title, svg: !!b.querySelector('svg'), icon: b.querySelector('svg path')?.getAttribute('d')?.slice(0, 14), index: bar.indexOf(b), more: bar.findIndex((x) => x.getAttribute('aria-label') === 'Mehr'), fav: bar.findIndex((x) => /Favorit/i.test(x.title)), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), favW: Math.round(b.previousElementSibling.getBoundingClientRect().width), favH: Math.round(b.previousElementSibling.getBoundingClientRect().height) }; })()`);
  check('Mit Seerr: ein Warnschild "Problem melden" steht gleich in der Leiste der Detailseite, mit Beschriftung fuer Hilfsprogramme', !!direct && direct.label === 'Problem melden' && direct.title === 'Problem melden' && direct.svg, JSON.stringify(direct));
  check('...zwischen Favorit und "Mehr", gleich gross wie die anderen runden Knoepfe', !!direct && direct.index === direct.fav + 1 && direct.index === direct.more - 1 && direct.w === direct.favW && direct.h === direct.favH, JSON.stringify(direct));
  await ctx.capture(path.join(out, 'SI-warnschild.png'));
  await ctx.run(`document.querySelector('.detail-actions [data-action="issue"]').click()`);
  check('Ein Klick auf das Warnschild oeffnet das Fenster (ohne Umweg ueber das Menue)', (await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000)) && /Problem melden: Paper Moons/.test(await ctx.run(`document.querySelector('.mdl-title').textContent`)));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);
  await openMenu();
  const labels = await menuLabels();
  check('Mit Seerr: der Eintrag "Problem melden …" steht im Menue "Mehr" (bei einem Film mit TMDB-Nummer)', labels.some((l) => /^Problem melden/.test(l)), labels.join(' | '));
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  check('Das Fenster oeffnet sich mit dem Titel des Films', (await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000)) && (await ctx.run(`/Problem melden: Paper Moons/.test(document.querySelector('.mdl-title').textContent)`)), await ctx.run(`document.querySelector('.mdl-title')?.textContent`));
  check('...vier Arten: Video, Audio, Untertitel, Sonstiges', JSON.stringify(await ctx.run(`[...document.querySelectorAll('.issue-type')].map((b) => b.textContent.trim())`)) === JSON.stringify(['Video', 'Audio', 'Untertitel', 'Sonstiges']));
  check('...ein freiwilliger Kommentar (Beschriftung "Kommentar (freiwillig)")', await ctx.run(`/freiwillig/.test(document.querySelector('.mdl-field span')?.textContent ?? '') && !!document.querySelector('textarea.issue-comment')`));
  check('..."Melden" ist erst nach der Wahl einer Art moeglich', await ctx.run(`${sendBtn()}.disabled === true`));
  await ctx.capture(path.join(out, 'SI-fenster.png'));
  await pickType('subtitles');
  check('Art gewaehlt: sie ist markiert (nur eine) und "Melden" ist frei', await ctx.run(`document.querySelectorAll('.issue-type.on').length === 1 && document.querySelector('.issue-type.on').dataset.type === 'subtitles' && document.querySelector('.issue-type.on').getAttribute('aria-checked') === 'true' && ${sendBtn()}.disabled === false`));
  await ctx.run(`(() => { const t = document.querySelector('textarea.issue-comment'); t.value = 'Untertitel fehlen ab Minute 10'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.wait(500);
  const styles = await ctx.run(`(() => { const on = document.querySelector('.issue-type.on'); const off = document.querySelector('.issue-type:not(.on)'); const cs = (e) => { const s = getComputedStyle(e); return { bg: s.backgroundImage.slice(0, 160), border: s.borderTopColor, color: s.color, shadow: s.boxShadow.slice(0, 60) }; }; return { on: cs(on), off: cs(off), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb') }; })()`);
  check('Die gewaehlte Art ist klar markiert: Rahmen in Textfarbe mit zweitem Ring, hellere Schrift (auch bei grauem Akzent)', styles.on.border === styles.on.color && /0px 0px 0px 1px/.test(styles.on.shadow) && styles.on.color !== styles.off.color && styles.on.bg !== styles.off.bg, JSON.stringify(styles));
  await ctx.capture(path.join(out, 'SI-ausgefuellt.png'));
  await ctx.run(`${sendBtn()}.click()`);
  check('Senden: Seerr bekommt Art Untertitel (3), den Kommentar und die Seerr-Nummer des Films (42)', await waitFor(`true`) && (await (async () => { const end = Date.now() + 4000; while (Date.now() < end && !SEERR.issues.length) await ctx.wait(80); return SEERR.issues.length === 1 && lastIssue().issueType === 3 && lastIssue().message === 'Untertitel fehlen ab Minute 10' && lastIssue().media.id === 42; })()), JSON.stringify(lastIssue()));
  check('...das Fenster schliesst sich, eine Bestaetigung erscheint', (await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000)) && /gemeldet/.test(await toasts()), await toasts());

  // ---------- Ohne Kommentar ----------
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('audio');
  await ctx.run(`${sendBtn()}.click()`);
  await waitFor(`true`);
  const end1 = Date.now() + 4000;
  while (Date.now() < end1 && SEERR.issues.length < 2) await ctx.wait(80);
  check('Ohne Kommentar: die Meldung geht trotzdem raus, mit Ersatztext (Art genannt, nie leer)', SEERR.issues.length === 2 && lastIssue().issueType === 2 && /Audio/.test(lastIssue().message) && lastIssue().message.length > 5, JSON.stringify(lastIssue()));
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);

  // ---------- Abbrechen ----------
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('video');
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc schliesst das Fenster ohne zu senden', (await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000)) && SEERR.issues.length === 2, String(SEERR.issues.length));

  // ---------- Serie und Folge ----------
  await openItem(show);
  await openMenu();
  check('Serie: der Eintrag ist da', (await menuLabels()).some((l) => /^Problem melden/.test(l)), (await menuLabels()).join(' | '));
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('video');
  await ctx.run(`${sendBtn()}.click()`);
  const end2 = Date.now() + 4000;
  while (Date.now() < end2 && SEERR.issues.length < 3) await ctx.wait(80);
  check('Serie: Art Video (1), Seerr-Nummer der Serie (13), Staffel und Folge 0 (alle)', SEERR.issues.length === 3 && lastIssue().issueType === 1 && lastIssue().media.id === 13 && lastIssue().problemSeason === 0 && lastIssue().problemEpisode === 0, JSON.stringify(lastIssue()));
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);

  await openItem(episode);
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  check('Folge: die Ueberschrift nennt Serie, Staffel und Folge', await ctx.run(`/Starfall Station.*Staffel 1, Folge 2/.test(document.querySelector('.mdl-title').textContent)`), await ctx.run(`document.querySelector('.mdl-title').textContent`));
  await pickType('other');
  await ctx.run(`(() => { const t = document.querySelector('textarea.issue-comment'); t.value = 'Folge endet zu frueh'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.run(`${sendBtn()}.click()`);
  const end3 = Date.now() + 4000;
  while (Date.now() < end3 && SEERR.issues.length < 4) await ctx.wait(80);
  check('Folge: Staffel 1 und Folge 2 gehen mit, Art Sonstiges (4)', SEERR.issues.length === 4 && lastIssue().issueType === 4 && lastIssue().problemSeason === 1 && lastIssue().problemEpisode === 2 && lastIssue().message === 'Folge endet zu frueh', JSON.stringify(lastIssue()));
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);

  // ---------- Fehler bleiben im Fenster ----------
  SEERR.issueForbidden = true;
  await openItem(movie);
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('video');
  await ctx.run(`(() => { const t = document.querySelector('textarea.issue-comment'); t.value = 'Mein Text darf nicht verloren gehen'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.run(`${sendBtn()}.click()`);
  check('Kein Recht (403): eine klare Meldung im Fenster, das Fenster bleibt offen, der Text bleibt', (await waitFor(`!!document.querySelector('.mdl-error:not([hidden])')`, 4000)) && (await ctx.run(`/darf keine Probleme melden/.test(document.querySelector('.mdl-error').textContent) && document.querySelector('textarea.issue-comment').value === 'Mein Text darf nicht verloren gehen' && !${sendBtn()}.disabled`)), await ctx.run(`document.querySelector('.mdl-error')?.textContent`));
  await ctx.capture(path.join(out, 'SI-fehler.png'));
  SEERR.issueForbidden = false;
  await ctx.run(`${sendBtn()}.click()`);
  const end4 = Date.now() + 4000;
  while (Date.now() < end4 && SEERR.issues.length < 5) await ctx.wait(80);
  check('...danach klappt dasselbe Fenster beim naechsten Versuch (ohne neu einzugeben)', SEERR.issues.length === 5 && lastIssue().message === 'Mein Text darf nicht verloren gehen', JSON.stringify(lastIssue()));
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);

  // Fenster waehrend des Sendens geschlossen und die Meldung scheitert: der Fehler darf nicht im unsichtbaren Fenster verschwinden
  SEERR.issueForbidden = true;
  SEERR.issueDelay = 700;
  const before = SEERR.issues.length;
  await openItem(movie);
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('audio');
  await ctx.run(`${sendBtn()}.click()`);
  await ctx.wait(150);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Fenster waehrend des Sendens geschlossen: es ist weg', await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000));
  const sawError = await waitFor(`[...document.querySelectorAll('.toast.error')].some((t) => /darf keine Probleme melden/.test(t.innerText))`, 4000);
  check('...scheitert die Meldung, erscheint der Fehler als Hinweis (nicht still im geschlossenen Fenster)', sawError && SEERR.issues.length === before, await toasts());
  SEERR.issueForbidden = false;
  SEERR.issueDelay = 0;

  // Titel, den Seerr nicht kennt
  await openItem(unknown);
  await openMenu();
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Problem melden/.test(b.textContent)).click()`);
  await waitFor(`!!document.querySelector('.mdl-scrim .issue-types')`, 4000);
  await pickType('video');
  await ctx.run(`${sendBtn()}.click()`);
  check('Seerr kennt den Titel nicht: Hinweis, die Bibliothek in Seerr zu synchronisieren', (await waitFor(`!!document.querySelector('.mdl-error:not([hidden])')`, 4000)) && (await ctx.run(`/kennt diesen Titel noch nicht/.test(document.querySelector('.mdl-error').textContent)`)), await ctx.run(`document.querySelector('.mdl-error')?.textContent`));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(`!document.querySelector('.mdl-scrim:not(.closing)')`, 3000);

  // Film ohne TMDB-Nummer
  await openItem(other);
  await openMenu();
  check('Film ohne TMDB-Nummer: kein Eintrag (er liesse sich nicht zuordnen)', !(await menuLabels()).some((l) => /Problem melden/.test(l)), (await menuLabels()).join(' | '));
  await closeMenuKey();
  check('...und auch kein Warnschild in der Leiste', !(await ctx.run(`!!document.querySelector('.detail-actions [data-action="issue"]')`)));

  // Seerr getrennt
  await ctx.run(`window.jc.seerrDisconnect().then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(1500);
  await openItem(movie);
  await openMenu();
  check('Seerr getrennt: der Eintrag ist wieder weg', !(await menuLabels()).some((l) => /Problem melden/.test(l)), (await menuLabels()).join(' | '));
  await closeMenuKey();
  check('...und das Warnschild auch', !(await ctx.run(`!!document.querySelector('.detail-actions [data-action="issue"]')`)));

  const fs = require('node:fs');
  const root = path.join(__dirname, '..', '..');
  check('Quelltext: die Meldung laeuft ueber den Hauptprozess (seerr:issue), die Oberflaeche kennt keine Seerr-Zugangsdaten', /seerr:issue/.test(fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8')) && !/X-Api-Key|connect\.sid/.test(fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'views', 'issue-dialog.js'), 'utf8')));
  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
  void state;
};
