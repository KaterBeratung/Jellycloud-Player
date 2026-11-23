// Detailseite und Kontextmenues (P16, nach PlayAction, SeasonChoice, ItemActions und DetailView+Information der Apple-App), Mock-Server auf Port 8986:
//  - Kontextmenue jeder Karte (Rechtsklick am Mauszeiger, langes Druecken und Tastatur unter dem Plakat): Fortsetzen/Abspielen, Von vorn, Aus
//    "Weiterschauen" entfernen, Gesehen, Favorit; danach zeigen alle Seiten den Stand des Servers, ohne Neuaufbau (Startseite: Reihen an ihrer Stelle,
//    Banner bleibt; Mediathek: die Karte an ihrem Platz; Detailseite: Folgen und "Abspielen"); Top 10: am Plakat, nicht an der Ziffer
//  - Detailseite: "S1 E4 Fortsetzen ab 12:40", Staffel beim Oeffnen (nicht die Extras), Knopfreihe in zwei Zeilen, "Gesehen" als Tag, Informationsblock
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/item-menu.js
const path = require('node:path');
const crypto = require('node:crypto');
const { server, state, items, children, add, MOVIES_VIEW, SEERR } = require('../mock-server');

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
  const PORT = 8986;
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
    await ctx.wait(400);
  };
  const byName = (type, name) => [...items.values()].find((i) => i.Type === type && i.Name === name);
  const episodeOf = (series, s, e) => [...items.values()].find((i) => i.Type === 'Episode' && i.SeriesId === series.Id && i.ParentIndexNumber === s && i.IndexNumber === e);
  const clock = (sec) => {
    const t = Math.max(0, Math.floor(sec));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };
  const input = (ev) => ctx.win.webContents.sendInputEvent(ev);
  /** Holt sel in die Mitte des Bildes (ohne Bewegung), falls es nicht schon ganz zu sehen ist. */
  const reveal = async (sel) => {
    const moved = await ctx.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); if (r.top >= 110 && r.bottom <= innerHeight - 10 && r.left >= 0 && r.right <= innerWidth) return false; el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); return true; })()`);
    if (moved) await ctx.wait(400);
  };
  /** Echter Rechtsklick (Maus) auf die Mitte des oberen Drittels von sel; gibt die Stelle zurueck. */
  const rightClick = async (sel) => {
    await reveal(sel);
    const p = await ctx.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 3) }; })()`);
    if (!p) return null;
    input({ type: 'mouseMove', x: p.x, y: p.y });
    input({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 });
    input({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 });
    await waitFor(`!!document.querySelector('.menu.open:not(.closing)')`, 2000);
    await ctx.wait(150);
    return p;
  };
  const menu = () => ctx.run(`(() => { const m = document.querySelector('.menu:not(.closing)'); if (!m) return null; const r = m.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), labels: [...m.querySelectorAll('.menu-item .lbl')].map((l) => l.textContent) }; })()`);
  const pick = (label) => ctx.run(`[...document.querySelectorAll('.menu:not(.closing) .menu-item')].find((b) => b.querySelector('.lbl').textContent === ${JSON.stringify(label)})?.click()`);
  const noMenu = () => waitFor(`!document.querySelector('.menu')`, 1500);
  const resumeMenu = ['Fortsetzen', 'Von vorn', 'Aus „Weiterschauen“ entfernen', 'Als gesehen markieren'];

  const aurora = byName('Movie', 'Aurora Protocol');
  const neon = byName('Movie', 'Neon Harbor');
  const orbit = byName('Movie', 'A Quiet Orbit');
  const starfall = byName('Series', 'Starfall Station');
  const winter = byName('Series', 'The Winter Archive');
  const latestRow = `latest:${MOVIES_VIEW.Id}`;

  // ---------- 1. Startseite: Menue am Mauszeiger, Aus "Weiterschauen" entfernen ohne Neuaufbau ----------
  await go('#/home', `!!document.querySelector('.home .rows [data-row="continue"] .card')`);
  await ctx.wait(1200);
  const contCard = `.home .rows [data-row="continue"] .card[data-item-id="${aurora.Id}"] .thumb`;
  const at = await rightClick(contCard);
  const m1 = await menu();
  check('Rechtsklick auf eine Karte: das Menue des Eintrags', !!m1 && JSON.stringify(m1.labels) === JSON.stringify([...resumeMenu, 'Zu Favoriten']), JSON.stringify(m1?.labels));
  check('Das Menue steht am Mauszeiger (wie ein Kontextmenue des Systems)', !!m1 && Math.abs(m1.left - at.x) <= 2 && Math.abs(m1.top - at.y) <= 2, JSON.stringify({ at, m1: m1 && { left: m1.left, top: m1.top } }));
  await ctx.capture(path.join(out, 'M-01-kontextmenue.png'));
  input({ type: 'keyDown', keyCode: 'Escape' });
  input({ type: 'keyUp', keyCode: 'Escape' });
  check('Escape schliesst das Menue', await noMenu());
  // Klick daneben schliesst es, auch auf der Karte selbst (der Klick oeffnet dann den Titel, das Menue bleibt nicht ueber der neuen Seite stehen)
  await rightClick(contCard);
  const blank = await ctx.run(`(() => { const r = document.querySelector('.home .rows').getBoundingClientRect(); return { x: Math.round(r.right - 8), y: Math.round(r.top + 4) }; })()`);
  input({ type: 'mouseDown', x: blank.x, y: blank.y, button: 'left', clickCount: 1 });
  input({ type: 'mouseUp', x: blank.x, y: blank.y, button: 'left', clickCount: 1 });
  check('Ein Klick daneben schliesst das Menue', await noMenu());
  // Scrollen der Seite von selbst (eine Reihe, die sich an ihre Stelle schiebt) laesst es offen; das Mausrad des Nutzers schliesst es
  await rightClick(contCard);
  await ctx.run(`(() => { document.querySelector('#view').scrollBy({ top: 3, behavior: 'instant' }); document.querySelector('.home .rows [data-row="${latestRow}"] .scroller').scrollBy({ left: 40, behavior: 'instant' }); })()`);
  await ctx.wait(400);
  check('Scrollen ohne Zutun des Nutzers laesst das Menue offen', await ctx.run(`!!document.querySelector('.menu.open:not(.closing)')`));
  input({ type: 'mouseWheel', x: blank.x, y: blank.y + 200, deltaX: 0, deltaY: -120 });
  check('Das Mausrad neben dem Menue schliesst es', await noMenu());
  await ctx.run(`document.querySelector('.home .rows [data-row="${latestRow}"] .scroller').scrollTo({ left: 0, behavior: 'instant' })`);
  await rightClick(contCard);
  await ctx.run(`location.hash = '#/library/${MOVIES_VIEW.Id}'`);
  check('Ein Seitenwechsel schliesst das Menue', await noMenu());
  await go('#/home', `!!document.querySelector('.home .rows [data-row="continue"] .card')`);
  await ctx.wait(800);

  // Vorher: Banner markieren, die Reihe "Neu in Filme" ein Stueck verschieben, Platzhalter beobachten
  await reveal(contCard);
  await ctx.run(`(() => { document.querySelector('.home .hero').__mark = 1; document.querySelector('.home .rows [data-row="${latestRow}"] .scroller').scrollTo({ left: 240, behavior: 'instant' }); window.__sk = 0; const mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('.skeleton, .hero-skeleton, .top10-row.loading') || n.querySelector('.skeleton, .hero-skeleton'))) window.__sk++; }); mo.observe(document.querySelector('.home'), { childList: true, subtree: true }); })()`);
  const top0 = await ctx.run(`document.querySelector('#view').scrollTop`);
  const left0 = await ctx.run(`document.querySelector('.home .rows [data-row="${latestRow}"] .scroller').scrollLeft`);
  await rightClick(contCard);
  await pick('Aus „Weiterschauen“ entfernen');
  const gone = await waitFor(`!document.querySelector('${contCard.replace(' .thumb', '')}')`, 6000);
  check('Aus "Weiterschauen" entfernen: der Titel faellt aus der Reihe (Stand des Servers: keine gemerkte Stelle mehr)', gone && !state.progress.has(aurora.Id));
  check('...mit Meldung', await waitFor(`document.body.innerText.includes('Aus „Weiterschauen“ entfernt')`, 3000));
  const after1 = await ctx.run(`(() => { const row = document.querySelector('.home .rows [data-row="${latestRow}"]'); const card = row?.querySelector('.card'); return { hero: document.querySelector('.home .hero')?.__mark === 1, sk: window.__sk, top: document.querySelector('#view').scrollTop, left: row?.querySelector('.scroller').scrollLeft, anim: card ? getComputedStyle(card).animationName : '?' }; })()`);
  check('Die Startseite baut sich nicht neu auf: das Banner bleibt, keine Platzhalter', after1.hero && after1.sk === 0, JSON.stringify(after1));
  check('Die Seite und jede Reihe bleiben an ihrer Stelle', Math.abs(after1.top - top0) <= 1 && Math.abs(after1.left - left0) <= 2 && left0 > 100, JSON.stringify({ top0, left0, after1 }));
  check('Die neuen Karten steigen nicht noch einmal ein (kein Flackern)', after1.anim === 'none', after1.anim);

  // Favorit ueber das Menue: die Reihe "Favoriten" zeigt ihn danach
  const neonLatest = `.home .rows [data-row="${latestRow}"] .card[data-item-id="${neon.Id}"]`;
  await ctx.run(`document.querySelector('${neonLatest}')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
  await ctx.wait(500);
  await rightClick(`${neonLatest} .thumb`);
  const m2 = await menu();
  check('Angefangener Film in einer anderen Reihe: dasselbe Menue', !!m2 && JSON.stringify(m2.labels) === JSON.stringify([...resumeMenu, 'Zu Favoriten']), JSON.stringify(m2?.labels));
  await pick('Zu Favoriten');
  check('Zu Favoriten: die Reihe "Favoriten" zeigt den Titel (ohne die Seite neu aufzubauen)', await waitFor(`!!document.querySelector('.home .rows [data-row="favorites"] .card[data-item-id="${neon.Id}"]')`, 6000) && state.fav.has(neon.Id) && (await ctx.run(`document.querySelector('.home .hero')?.__mark === 1`)));
  await rightClick(`.home .rows [data-row="favorites"] .card[data-item-id="${neon.Id}"] .thumb`);
  const m3 = await menu();
  check('Danach bietet das Menue "Favorit entfernen" (mit durchgestrichenem Herz)', !!m3 && m3.labels.at(-1) === 'Favorit entfernen' && (await ctx.run(`!!document.querySelector('.menu:not(.closing) .menu-item:last-child .check svg')`)), JSON.stringify(m3?.labels));
  input({ type: 'keyDown', keyCode: 'Escape' });
  await noMenu();

  // ---------- 2. Mediathek: die Karte an ihrem Platz, Finger und Tastatur unter dem Plakat ----------
  await go(`#/library/${MOVIES_VIEW.Id}`, `!!document.querySelector('.library .grid .card[data-item-id="${orbit.Id}"]')`);
  await ctx.wait(800);
  const orbitCard = `.library .grid .card[data-item-id="${orbit.Id}"]`;
  await ctx.run(`(() => { const c = document.querySelector('${orbitCard}'); c.scrollIntoView({ block: 'center' }); c.__mark = 1; })()`);
  await ctx.wait(500);
  const before2 = await ctx.run(`(() => { const c = document.querySelector('${orbitCard}'); return { top: document.querySelector('#view').scrollTop, index: [...c.parentElement.children].indexOf(c), cards: document.querySelectorAll('.library .grid .card').length }; })()`);
  await rightClick(`${orbitCard} .thumb`);
  const m4 = await menu();
  check('Nicht angefangener Film: Abspielen, Gesehen, Favorit', !!m4 && JSON.stringify(m4.labels) === JSON.stringify(['Abspielen', 'Als gesehen markieren', 'Zu Favoriten']), JSON.stringify(m4?.labels));
  await pick('Als gesehen markieren');
  const replaced = await waitFor(`(() => { const c = document.querySelector('${orbitCard}'); return !!c && !c.__mark && !!c.querySelector('.corner.played'); })()`, 6000);
  const after2 = await ctx.run(`(() => { const c = document.querySelector('${orbitCard}'); return { top: document.querySelector('#view').scrollTop, index: [...c.parentElement.children].indexOf(c), cards: document.querySelectorAll('.library .grid .card').length, anim: getComputedStyle(c).animationName }; })()`);
  check('Als gesehen markieren: die Karte zeigt den Haken (an ihrem Platz neu gebaut, Stand des Servers)', replaced && state.played.has(orbit.Id), JSON.stringify(after2));
  check('...die Mediathek bleibt stehen (gleiche Stelle, gleiche Zahl Karten, kein Einsteigen)', after2.index === before2.index && after2.cards === before2.cards && Math.abs(after2.top - before2.top) <= 1 && after2.anim === 'none', JSON.stringify({ before2, after2 }));
  // Langes Druecken (Android, Zeigerart "touch") und Tastatur (Menue-Taste, Umschalt+F10: ohne Zeiger): unter dem Plakat. Die Maus geht vorher weg (sonst
  // hebt sich das Plakat gerade unter ihr und seine Lage aendert sich waehrend der Messung)
  input({ type: 'mouseMove', x: 1400, y: 130 });
  await ctx.wait(600);
  for (const [what, ev] of [
    ['Langes Druecken', `new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 30, clientY: r.top + 40 })`],
    ['Tastatur', `new MouseEvent('contextmenu', { bubbles: true, cancelable: true })`]
  ]) {
    const placed = await ctx.run(`(() => { const t = document.querySelector('${orbitCard} .thumb'); const r = t.getBoundingClientRect(); const handled = !t.dispatchEvent(${ev}); return { handled, thumb: { left: Math.round(r.left), bottom: Math.round(r.bottom), top: Math.round(r.top) } }; })()`);
    await waitFor(`!!document.querySelector('.menu.open:not(.closing)')`, 2000);
    const m = await menu();
    // Das Menue blendet mit einer kleinen Bewegung ein: seine Lage waehrend des Einblendens weicht um wenige Punkte ab
    const below = !!m && ((m.top >= placed.thumb.bottom - 2 && m.top <= placed.thumb.bottom + 24) || m.top + 4 <= placed.thumb.top) && Math.abs(m.left - placed.thumb.left) <= 12;
    check(`${what}: das Menue haengt am Plakat (darunter oder darueber), das Ereignis ist behandelt (kein Menue des Systems, keine Textauswahl)`, placed.handled && below, JSON.stringify({ placed, m: m && { left: m.left, top: m.top } }));
    input({ type: 'keyDown', keyCode: 'Escape' });
    await noMenu();
  }

  // ---------- 3. Detailseite eines angefangenen Films: Beschriftung, Knopfreihe, Gesehen, Informationen ----------
  const neonPos = state.progress.get(neon.Id) / 1e7;
  await go(`#/item/${neon.Id}`, `!!document.querySelector('.detail .detail-actions [data-action="play"]')`);
  await ctx.wait(600);
  const d1 = await ctx.run(`(() => { const rows = [...document.querySelectorAll('.detail .detail-actions-row')]; const box = (e) => e.getBoundingClientRect(); return { play: document.querySelector('.detail [data-action="play"]').textContent.trim(), first: [...rows[0].children].map((b) => b.dataset.action ?? b.getAttribute('aria-label')), second: [...rows[1].children].filter((b) => !b.hidden).map((b) => b.dataset.action), w1: Math.round(box(rows[0]).width), w2: Math.round(box(rows[1]).width), b: [...rows[1].children].filter((b) => !b.hidden).map((b) => Math.round(box(b).width)) }; })()`);
  check('Angefangener Film: "Fortsetzen ab" mit der gemerkten Stelle', d1.play === `Fortsetzen ab ${clock(neonPos)}`, d1.play);
  check('Knopfreihe wie die Apple-App: Abspielen, Favorit, Gesehen, Mehr', JSON.stringify(d1.first.slice(0, 3)) === JSON.stringify(['play', 'favorite', 'played']) && d1.first.at(-1) === 'Mehr', JSON.stringify(d1.first));
  check('...darunter Von vorn und Trailer zu gleichen Teilen, so breit wie die Zeile darueber', JSON.stringify(d1.second) === JSON.stringify(['restart', 'trailer']) && Math.abs(d1.w1 - d1.w2) <= 1 && Math.abs(d1.b[0] - d1.b[1]) <= 1, JSON.stringify(d1));
  check('Das Menue "Mehr" bietet "Problem melden" nicht mehr (das Warnschild steht bei den Knoepfen, nur mit Seerr)', await (async () => { await ctx.run(`document.querySelector('.detail .detail-actions [aria-label="Mehr"]').click()`); await waitFor(`!!document.querySelector('.menu.open')`, 2000); const l = (await menu())?.labels ?? []; input({ type: 'keyDown', keyCode: 'Escape' }); await noMenu(); return l.length > 0 && !l.some((x) => /Problem/.test(x)); })());
  check('Informationen statt "Technische Details": Allgemein, Sprachen, Datei', await waitFor(`JSON.stringify([...document.querySelectorAll('.detail .info-block .info-group h3')].map((h) => h.textContent)) === '["Allgemein","Sprachen","Datei"]' && document.querySelector('.detail .info-block h2')?.textContent === 'Informationen'`, 4000));
  const wiedergabe = () => ctx.run(`(() => { const dt = [...document.querySelectorAll('.detail .info-block dt')].find((d) => d.textContent === 'Wiedergabe'); return dt ? dt.nextElementSibling.textContent : null; })()`);
  check('...die Zeile "Wiedergabe" nennt, wie der Server liefert (dasselbe wie das Tag)', await waitFor(`(() => { const dt = [...document.querySelectorAll('.detail .info-block dt')].find((d) => d.textContent === 'Wiedergabe'); const tag = document.querySelector('.detail .detail-tags .tag[data-kind="directPlay"], .detail .detail-tags .tag[data-kind="directStream"], .detail .detail-tags .tag[data-kind="transcode"]'); return !!dt && !!tag && dt.nextElementSibling.textContent === tag.textContent && getComputedStyle(tag).visibility === 'visible'; })()`, 6000), String(await wiedergabe()));
  await ctx.run(`document.querySelector('.detail-head').__mark = 1`);
  await ctx.run(`document.querySelector('.detail [data-action="played"]').click()`);
  const d2ok = await waitFor(`!!document.querySelector('.detail .detail-tags .tag.watched')`, 4000);
  const d2 = await ctx.run(`({ play: document.querySelector('.detail [data-action="play"]').textContent.trim(), label: document.querySelector('.detail [data-action="played"]').getAttribute('aria-label'), restart: document.querySelector('.detail [data-action="restart"]').hidden, chip: document.querySelector('.detail .detail-tags .tags > :first-child')?.textContent, same: document.querySelector('.detail-head').__mark === 1 })`);
  check('Gesehen auf der Detailseite: "Gesehen" vorn in der Tag-Zeile, der Knopf bietet das Gegenteil, "Abspielen" von vorn, kein "Von vorn"', d2ok && d2.chip === 'Gesehen' && d2.label === 'Als ungesehen markieren' && d2.play === 'Abspielen' && d2.restart && d2.same && state.played.has(neon.Id), JSON.stringify(d2));
  await ctx.capture(path.join(out, 'M-02-detail-film.png'));
  await ctx.run(`document.querySelector('.detail .info-block').scrollIntoView({ block: 'center' })`);
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'M-03-informationen.png'));
  // Zurueck zur Startseite (im Speicher des Routers): sie hat den neuen Stand, ohne sich neu aufzubauen
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`location.hash === '#/home' && !!document.querySelector('.home .rows')`, 4000);
  check('Zurueck auf der Startseite: der Film ist auch dort aus "Weiterschauen" (die Seite im Speicher hat nachgeladen)', await waitFor(`!document.querySelector('.home .rows [data-row="continue"] .card[data-item-id="${neon.Id}"]')`, 6000) && (await ctx.run(`document.querySelector('.home .hero')?.__mark === 1`)));

  // ---------- 4. Serie: Staffel beim Oeffnen, "S1 E4 Fortsetzen ab", Kontextmenue einer Folge ----------
  const ep4 = episodeOf(starfall, 1, 4);
  await go(`#/item/${starfall.Id}`, `!!document.querySelector('.detail .episodes .ep')`);
  await ctx.wait(600);
  const s1 = await ctx.run(`({ play: document.querySelector('.detail [data-action="play"]').textContent.trim(), tab: document.querySelector('.detail .season-tabs .tab.on')?.textContent, restart: document.querySelector('.detail [data-action="restart"]').hidden, groups: [...document.querySelectorAll('.detail .info-block .info-group h3')].map((h) => h.textContent), meta: document.querySelector('.detail .detail-meta').textContent })`);
  check('Serie mit angefangener Folge: "S1 E4 Fortsetzen ab" mit ihrer Stelle', s1.play === `S1 E4 Fortsetzen ab ${clock(state.progress.get(ep4.Id) / 1e7)}`, s1.play);
  check('...die Seite oeffnet mit der Staffel dieser Folge, ohne "Von vorn" (bei Serien nicht)', s1.tab === 'Staffel 1' && s1.restart, JSON.stringify(s1));
  check('...Angabenzeile mit der Zahl der Staffeln, Informationen nur "Allgemein" (eine Serie hat keine Datei)', /3 Staffeln/.test(s1.meta) && JSON.stringify(s1.groups) === '["Allgemein"]', JSON.stringify(s1));
  await ctx.run(`document.querySelector('.detail-head').__mark = 1`);
  const epRow = `.detail .episodes .ep[data-id="${ep4.Id}"]`;
  await rightClick(`${epRow} .ep-thumb`);
  const m5 = await menu();
  check('Kontextmenue einer Folge (wie die Karten)', !!m5 && JSON.stringify(m5.labels) === JSON.stringify([...resumeMenu, 'Zu Favoriten']), JSON.stringify(m5?.labels));
  await pick('Als gesehen markieren');
  const s2ok = await waitFor(`document.querySelector('.detail [data-action="play"]').textContent.trim() === 'S1 E5 Abspielen'`, 6000);
  const s2 = await ctx.run(`({ play: document.querySelector('.detail [data-action="play"]').textContent.trim(), played: !!document.querySelector('${epRow} .corner.played'), same: document.querySelector('.detail-head').__mark === 1, anim: getComputedStyle(document.querySelector('${epRow}')).animationName })`);
  check('Folge als gesehen markiert: "Abspielen" nennt die naechste Folge, die Zeile zeigt den Haken; die Seite baut sich nicht neu auf', s2ok && s2.played && s2.same && s2.anim === 'none' && state.played.has(ep4.Id), JSON.stringify(s2));
  await ctx.capture(path.join(out, 'M-04-detail-serie.png'));

  // Serie mit Extras (Staffel 0, steht beim Server vorn), alles gesehen: die Seite oeffnet mit Staffel 1 und "Abspielen" nimmt deren erste Folge
  const id32 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const firstEp = episodeOf(winter, 1, 1);
  const extras = add({ Id: id32('season:winter:extras'), Name: 'Extras', Type: 'Season', IndexNumber: 0, SeriesId: winter.Id, SeriesName: winter.Name, ImageTags: {}, ParentId: winter.Id }, null);
  children.get(winter.Id).unshift(extras.Id);
  const extraEp = add({ ...firstEp, Id: id32('ep:winter:extras:1'), Name: 'Hinter den Kulissen', IndexNumber: 1, ParentIndexNumber: 0, SeasonId: extras.Id, SeasonName: 'Extras' }, extras.Id);
  const winterEps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === winter.Id);
  winterEps.forEach((e) => state.played.add(e.Id));
  await go(`#/item/${winter.Id}`, `!!document.querySelector('.detail .episodes .ep')`);
  await ctx.wait(500);
  const w1 = await ctx.run(`({ tabs: [...document.querySelectorAll('.detail .season-tabs .tab')].map((t) => t.textContent), on: document.querySelector('.detail .season-tabs .tab.on')?.textContent, play: document.querySelector('.detail [data-action="play"]').textContent.trim() })`);
  check('Serie mit Extras, alles gesehen: die Seite oeffnet mit "Staffel 1" (nicht mit den Extras davor)', w1.tabs[0] === 'Extras' && w1.on === 'Staffel 1', JSON.stringify(w1));
  check('..."Abspielen" startet die erste Folge dieser Staffel', w1.play === 'S1 E1 Abspielen', w1.play);
  await ctx.run(`[...document.querySelectorAll('.detail .season-tabs .tab')].find((t) => t.textContent === 'Extras').click()`);
  check('Andere Staffel gewaehlt: "Abspielen" nimmt deren erste Folge (wie die Apple-App)', await waitFor(`document.querySelector('.detail [data-action="play"]').textContent.trim() === 'S0 E1 Abspielen'`, 4000));
  winterEps.forEach((e) => state.played.delete(e.Id));
  children.get(winter.Id).shift();
  items.delete(extras.Id);
  items.delete(extraEp.Id);
  children.delete(extras.Id);

  // ---------- 5. Top 10 (mit Seerr): das Menue haengt am Plakat, nicht an der Ziffer; Seite eines Seerr-Titels wie die Detailseite ----------
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })`);
  await ctx.wait(1500);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await go('#/home', `document.querySelectorAll('.home .top10-row:not(.loading) .t10-card:not(.ph)').length >= 3`);
  await ctx.wait(800);
  const t10 = `.home .top10-row[data-kind="movies"] .t10-card:not(.ph)`;
  await ctx.run(`document.querySelector('${t10}')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(500);
  const numeral = await ctx.run(`(() => { const c = document.querySelector('${t10}'); const t = c.querySelector('.thumb').getBoundingClientRect(); const f = c.querySelector('.t10-figure').getBoundingClientRect(); return { x: Math.round(f.left + Math.max(4, (t.left - f.left) / 2)), y: Math.round(t.top + t.height * 0.8), id: c.getAttribute('href') }; })()`);
  input({ type: 'mouseMove', x: numeral.x, y: numeral.y });
  input({ type: 'mouseDown', x: numeral.x, y: numeral.y, button: 'right', clickCount: 1 });
  input({ type: 'mouseUp', x: numeral.x, y: numeral.y, button: 'right', clickCount: 1 });
  await ctx.wait(500);
  check('Top 10: ein Rechtsklick auf die Ziffer oeffnet kein Menue', !(await ctx.run(`!!document.querySelector('.menu')`)), JSON.stringify(numeral));
  await rightClick(`${t10} .thumb`);
  const m6 = await menu();
  check('Top 10: am Plakat das Menue des Titels', !!m6 && m6.labels[0] === 'Abspielen' && m6.labels.includes('Als gesehen markieren') && m6.labels.includes('Zu Favoriten'), JSON.stringify(m6?.labels));
  input({ type: 'keyDown', keyCode: 'Escape' });
  await noMenu();
  SEERR.statuses.set('tv:1399', 5); // bei Seerr verfuegbar: die Seite bietet "Abspielen" (Starfall Station hat die Nummer 1399)
  await go('#/seerr/tv/1399', `!!document.querySelector('.seerr-page [data-action="play"]')`);
  const seerrPlay = await ctx.run(`document.querySelector('.seerr-page [data-action="play"]')?.textContent.trim() ?? ''`);
  check('Seite eines Seerr-Titels aus der Mediathek: "Abspielen" wie auf der Detailseite (Folge davor)', seerrPlay === 'S1 E5 Abspielen', seerrPlay);
  SEERR.statuses.delete('tv:1399');

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
