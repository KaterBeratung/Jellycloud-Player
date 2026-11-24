// Bedienungshilfen (Plan P23, B1, B3; JC_DEV=1, JC_FAKE_MPV=1): auf allen Seiten und in jedem Bereich der Einstellungen hat jedes bedienbare Element
// einen Namen (Bildschirmleser), mit der Tabulatortaste erreicht man nur sichtbare Elemente und sieht immer, wo der Fokus steht, und bei
// "Bewegung reduzieren" (Systemeinstellung, nachgestellt per prefers-reduced-motion) bewegt sich nichts mehr: kein Auftritt, kein Schimmern, kein Zoom,
// Fenster und Hinweise blenden nur ein und aus (wie Design/Motion.swift der Apple-App). Kontrast in allen vier Designs prueft audit-themes.js.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/access-audit.js
const path = require('node:path');
const { server, items } = require('../mock-server');
const { A11Y } = require('./audit-edge');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) errors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const wc = ctx.win.webContents;
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const go = async (hash, ready, wait = 1400) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 8000);
    await ctx.wait(wait);
  };
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const series = [...items.values()].find((i) => i.Type === 'Series');

  // ---------- Namen auf allen Seiten ----------
  const pages = [
    ['Startseite', '#/home', `!!document.querySelector('.home .rows .row')`],
    ['Filme', '#/movies', `!!document.querySelector('.grid .card')`],
    ['Serien', '#/shows', `!!document.querySelector('.grid .card')`],
    ['Anfragen (ohne Seerr)', '#/requests', `!!document.querySelector('.requests')`],
    ['Suche', '#/search?q=Aurora', `!!document.querySelector('.search .card')`],
    ['Detailseite Film', `#/item/${movie.Id}`, `!!document.querySelector('.detail .detail-actions')`],
    ['Detailseite Serie', `#/item/${series.Id}`, `!!document.querySelector('.detail .detail-actions')`],
    ['Mitteilungen', '#/notifications', `!!document.querySelector('.page')`]
  ];
  for (const [name, hash, ready] of pages) {
    await go(hash, ready);
    const issues = await ctx.run(A11Y);
    check(`${name}: jedes bedienbare Element hat einen Namen, keine doppelten IDs`, issues.length === 0, issues.slice(0, 5).join('; '));
  }
  // Personenseite: ueber die Besetzung der Detailseite
  await go(`#/item/${movie.Id}`, `!!document.querySelector('.detail a.person')`);
  const personHref = await ctx.run(`document.querySelector('.detail a.person')?.getAttribute('href') ?? null`);
  if (personHref) {
    await go(personHref, `!!document.querySelector('.person-head')`);
    const issues = await ctx.run(A11Y);
    check('Personenseite: jedes bedienbare Element hat einen Namen', issues.length === 0, issues.slice(0, 5).join('; '));
  } else check('Personenseite: Besetzung mit Verweis vorhanden', false);
  // Jeder Bereich der Einstellungen
  await go('#/settings', `!!document.querySelector('.settings-nav .snav')`);
  const sections = await ctx.run(`[...document.querySelectorAll('.settings-nav .snav')].map((a) => a.getAttribute('href'))`);
  const unnamed = [];
  for (const href of sections) {
    await go(href, `document.querySelector('.snav.on')?.getAttribute('href') === ${JSON.stringify(href)}`, 900);
    for (const issue of await ctx.run(A11Y)) unnamed.push(`${href.split('/').pop()}: ${issue}`);
  }
  check(`Einstellungen, alle ${sections.length} Bereiche: jedes bedienbare Element hat einen Namen`, sections.length >= 12 && unnamed.length === 0, unnamed.slice(0, 6).join('; ') || sections.join(' '));
  // Ein offenes Menue (Profilmenue in der Kopfzeile)
  await go('#/home', `!!document.querySelector('.home .rows .row')`, 600);
  await ctx.run(`document.querySelector('.toolpill .tool[aria-label="Profil"], .toolpill button[aria-label="Profil"]')?.click()`);
  const menuOpen = await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  const menuIssues = menuOpen ? await ctx.run(A11Y) : ['Menue nicht offen'];
  check('Profilmenue offen: jeder Eintrag hat einen Namen', menuOpen && menuIssues.length === 0, menuIssues.slice(0, 4).join('; '));
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(`!document.querySelector('.menu.open')`, 2000);

  // ---------- Tastatur: nur Sichtbares, und der Fokus ist immer zu sehen ----------
  // Fuer jedes per Tab erreichte Element: sichtbar (Groesse, Deckkraft, nicht verdeckt durch inert) und mit Fokus anders gezeichnet als ohne
  // (Umrandung, Schatten oder Flaeche am Element oder an seinem Bild).
  const FOCUS = `(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el.id === 'view') return { skip: true };
    const r = el.getBoundingClientRect();
    let op = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const visible = r.width > 1 && r.height > 1 && op > 0.2 && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden';
    // Ohne Uebergaenge vergleichen (sonst laege ein halber Uebergang in beiden Lesungen): Endzustand mit und ohne Fokus. Per CSSOM, ein eigenes
    // <style> verbietet die Content-Security-Policy der Seite
    const parts = [el, ...el.querySelectorAll('.thumb, .avatar')];
    parts.forEach((e) => e.style.setProperty('transition', 'none', 'important'));
    const look = () => parts.map((e) => { const s = getComputedStyle(e); return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? 'o' + s.outlineColor : '', s.boxShadow, s.backgroundColor, s.borderColor].join('|'); }).join('#');
    const focused = look();
    el.blur();
    const plain = look();
    parts.forEach((e) => e.style.removeProperty('transition'));
    return { visible, shown: focused !== plain, what: (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().slice(0, 28) };
  })()`;
  const tabWalk = async (label, hash, ready, steps = 24) => {
    await go(hash, ready, 900);
    ctx.win.focus();
    await ctx.run(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
    const bad = [];
    let seen = 0;
    for (let i = 0; i < steps; i++) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await ctx.wait(160);
      const f = await ctx.run(FOCUS);
      if (f.skip) continue;
      seen++;
      if (!f.visible) bad.push(`unsichtbar: ${f.what}`);
      else if (!f.shown) bad.push(`ohne Fokus-Zeichen: ${f.what}`);
    }
    check(`Tastatur ${label}: ${seen} Schritte, jedes erreichte Element ist sichtbar und zeigt den Fokus`, seen >= Math.min(10, steps / 2) && bad.length === 0, bad.slice(0, 5).join('; '));
  };
  await tabWalk('Startseite', '#/home', `!!document.querySelector('.home .rows .row')`);
  const slides = await ctx.run(`(() => { const s = [...document.querySelectorAll('.hero-slide')]; return { n: s.length, active: s.filter((x) => x.classList.contains('active') && !x.inert).length, hiddenInert: s.filter((x) => !x.classList.contains('active')).every((x) => x.inert) }; })()`);
  check('Banner: nur die gezeigte Folie nimmt Fokus und Klicks an, verdeckte und ausblendende sind inert', slides.n >= 2 && slides.active === 1 && slides.hiddenInert, JSON.stringify(slides));
  await tabWalk('Detailseite', `#/item/${movie.Id}`, `!!document.querySelector('.detail .detail-actions')`);
  await tabWalk('Einstellungen > Wiedergabe', '#/settings/behavior', `!!document.querySelector('.snav.on[href="#/settings/behavior"]')`, 30);

  // ---------- Bewegung reduzieren ----------
  // Bewegte Animationen und Uebergaenge (transform, translate, scale in den Schluesselbildern), solange die Seite aufbaut. Erlaubt: Ladekreis und
  // Zeitbalken des Banners (zeigen einen Vorgang an) und die Marke des gewaehlten Reiters, die zu ihm rueckt (Motion.move der Apple-App bleibt auch
  // bei reduzierter Bewegung: sie folgt der eigenen Wahl).
  const MOVING = `(() => document.getAnimations().map((a) => {
    const kf = a.effect?.getKeyframes?.() ?? [];
    const moves = kf.some((k) => (k.transform && k.transform !== 'none') || (k.translate && k.translate !== 'none') || (k.scale && k.scale !== 'none' && k.scale !== '1'));
    const t = a.effect?.target;
    return { name: a.animationName || a.transitionProperty || '?', moves, target: t ? (t.className?.toString?.() || t.tagName).slice(0, 36) : '?' };
  }).filter((x) => x.moves && !['spin', 'dot-run'].includes(x.name) && !/nav-indicator/.test(x.target)))()`;
  const movingOn = async (hash, ready) => {
    await ctx.run(`location.hash = '#/settings/about'`);
    await ctx.wait(700);
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    const found = [];
    const end = Date.now() + 1800;
    let readyNow = false;
    while (Date.now() < end) {
      readyNow ||= await ctx.run(ready).catch(() => false);
      for (const m of await ctx.run(MOVING)) found.push(`${m.name}@${m.target}`);
      await ctx.wait(60);
    }
    return { ready: readyNow, moving: [...new Set(found)] };
  };
  const homeReady = `!!document.querySelector('.home .rows .card')`;
  const detailReady = `!!document.querySelector('.detail .detail-actions')`;
  const full = await movingOn('#/home', homeReady);
  check('Ohne "Bewegung reduzieren" bewegen sich Inhalte beim Aufbau (die Pruefung ist nicht leer)', full.ready && full.moving.length > 0, full.moving.slice(0, 4).join(', '));
  await ctx.reducedMotion(true);
  check('"Bewegung reduzieren": das Wurzelelement folgt sofort (data-anim reduced)', await waitFor(`document.documentElement.dataset.anim === 'reduced'`, 2000));
  for (const [name, hash, ready] of [
    ['Startseite', '#/home', homeReady],
    ['Filme', '#/movies', `!!document.querySelector('.grid .card')`],
    ['Detailseite', `#/item/${movie.Id}`, detailReady],
    ['Einstellungen', '#/settings/appearance', `!!document.querySelector('.snav.on')`]
  ]) {
    const r = await movingOn(hash, ready);
    check(`Bewegung reduziert, ${name}: nichts steigt auf, zoomt oder rueckt beim Aufbau`, r.ready && r.moving.length === 0, r.moving.slice(0, 5).join(', '));
  }
  // Menue und Hinweis: nur Einblenden
  await go(`#/item/${movie.Id}`, detailReady, 600);
  await ctx.run(`document.querySelector('.detail .detail-actions [aria-label="Mehr"]')?.click()`);
  await ctx.wait(60);
  const menuMoves = await ctx.run(MOVING);
  const menuShown = await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  check('Bewegung reduziert: das Menue blendet nur ein (kein Wachsen, kein Rutschen)', menuShown && menuMoves.length === 0, menuMoves.map((m) => `${m.name}@${m.target}`).join(', '));
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(`!document.querySelector('.menu.open')`, 2000);
  await go('#/settings/general', `!!document.querySelector('.snav.on[href="#/settings/general"]')`, 600);
  await ctx.run(`[...document.querySelectorAll('.settings .btn')].find((b) => /^(Leeren|Clear)$/.test(b.textContent.trim()))?.click()`);
  await ctx.wait(80);
  const toastMoves = await ctx.run(MOVING);
  const toastShown = await waitFor(`!!document.querySelector('.toast')`, 2000);
  check('Bewegung reduziert: ein Hinweis (Toast) blendet nur ein', toastShown && toastMoves.length === 0, toastMoves.map((m) => `${m.name}@${m.target}`).join(', '));
  await ctx.capture(path.join(out, 'AA-reduced-settings.png'));
  await ctx.reducedMotion(false);

  // ---------- Kontrast erhoehen (Apple-App Build 94, BH5): gedaempfte Schrift und Kanten werden kraeftiger, in jedem Design ----------
  const lum = (css) => {
    // rgb(161, 161, 168) oder color(srgb 0.79 0.79 0.8) (color-mix liefert die zweite Form)
    const k = /^color\(srgb/.test(css) ? 255 : 1;
    const m = (css.replace(/^color\(srgb/, '').match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]).map((v) => v * k);
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
  };
  const muted = () => ctx.run(`(() => { const p = document.createElement('p'); p.style.color = 'var(--muted)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  const before = await muted();
  const dbg = ctx.win.webContents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
    await ctx.wait(200);
    const more = await muted();
    check('Kontrast erhöhen: gedaempfte Schrift wird heller (naeher an der Textfarbe)', lum(more) > lum(before) * 1.25, `${before} -> ${more}`);
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'no-preference' }] });
  } catch (e) {
    check('Kontrast erhöhen: Emulation moeglich', false, e.message);
  }

  check('Keine Konsolenfehler oder -warnungen', errors.length === 0, errors.slice(0, 4).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
