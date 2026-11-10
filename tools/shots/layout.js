// Layout-Pruefung: besucht alle Seiten in mehreren Fenstergroessen, sucht Ueberlappungen,
// verdeckte Elemente und horizontales Scrollen und speichert Screenshots.
const path = require('node:path');
const { server, setAdmin } = require('../mock-server');

const CHECK = `(() => {
  const issues = [];
  const rect = (el) => el.getBoundingClientRect();
  const vis = (el) => { const r = rect(el); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const overlap = (a, b) => { const x = rect(a), y = rect(b); return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1.5; };
  const name = (el) => el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : el.tagName.toLowerCase();
  const pair = (a, b, label) => { for (const x of document.querySelectorAll(a)) for (const y of document.querySelectorAll(b)) if (x !== y && vis(x) && vis(y) && !x.contains(y) && !y.contains(x) && overlap(x, y)) issues.push(label + ': ' + name(x) + ' x ' + name(y)); };
  const W = innerWidth;
  // Fensterbuttons (Titelleiste) belegen rechts ~140px im Kopfbereich
  const tools = document.querySelector('.tools');
  const tb = document.querySelector('.titlebar'); if (tb && Math.round(rect(tb).height) !== 36) issues.push('Titelzeile nicht 36px hoch');
  if (tools && tb && rect(tools).top < rect(tb).bottom - 0.5) issues.push('Icons ragen in die Titelzeile (Fensterknoepfe)');
  const nav = document.querySelector('.navpill') || document.querySelector('.nav');
  if (nav && tools && overlap(nav, tools)) issues.push('Navigation x Tools');
  // Navigationskapsel in Logo-Hoehe (44 px); nichts darin darf herausragen
  const pillEl = document.querySelector('.navpill');
  if (pillEl) {
    const ph = Math.round(rect(pillEl).height);
    if (ph !== 44) issues.push('Kapsel nicht in Logo-Hoehe: ' + ph + 'px');
    for (const k of pillEl.querySelectorAll('.nav-link')) {
      const r = rect(k), pr = rect(pillEl);
      if (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) issues.push('Element ragt aus der Kapsel: ' + (k.textContent || '').trim());
    }
    // Die Marke (Jellycloud) steht links neben der Navigation, in gleicher Hoehe, am Seitenrand, und ueberlappt weder sie noch die Fensterknoepfe
    const brandEl = document.querySelector('.navrow-start .brand');
    if (!brandEl) issues.push('Marke nicht links in der Kopfzeile');
    else {
      const br = rect(brandEl), pr = rect(pillEl);
      if (Math.round(br.height) !== 44) issues.push('Marke nicht 44px hoch: ' + Math.round(br.height));
      if (Math.abs((br.top + br.bottom) / 2 - (pr.top + pr.bottom) / 2) > 1) issues.push('Marke nicht auf einer Hoehe mit der Navigation');
      if (br.right > pr.left - 4) issues.push('Marke x Navigation: ' + Math.round(br.right) + ' > ' + Math.round(pr.left));
      if (br.left > 60 || br.left < 10) issues.push('Marke nicht am linken Rand: x=' + Math.round(br.left));
    }
  }
  // Rechte Kapsel: gleiche Hoehe wie die linke, vier identische runde Scheiben (Suche, Neu laden, Einstellungen, Konto), nichts ragt heraus
  const toolPill = document.querySelector('.toolpill');
  if (toolPill) {
    const pr = rect(toolPill);
    if (Math.round(pr.height) !== 44) issues.push('Werkzeug-Kapsel nicht 44px hoch: ' + Math.round(pr.height));
    const dims = [...toolPill.children].map((c) => Math.round(rect(c).width) + 'x' + Math.round(rect(c).height));
    if (new Set(dims).size !== 1 || ![4, 5].includes(toolPill.children.length)) issues.push('Kopfzeilen-Icons nicht gleich gross: ' + dims.join(', '));
    for (const c of toolPill.children) {
      const r = rect(c);
      if (Math.abs(r.width - r.height) > 0.5) issues.push('Kopfzeilen-Icon nicht rund: ' + name(c));
      if (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5 || r.left < pr.left - 0.5 || r.right > pr.right + 0.5) issues.push('Kopfzeilen-Icon ragt aus der Kapsel: ' + name(c));
    }
  }
  // Besetzung: Avatare muessen Kreise bleiben (auch ohne Foto)
  for (const a of document.querySelectorAll('.person .avatar')) { const r = rect(a); if (Math.abs(r.width - r.height) > 0.5 || Math.round(r.width) !== 96) issues.push('Besetzung: Avatar nicht rund/96px (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')'); }
  const brand = document.querySelector('.brand'), navLinks = document.querySelector('.nav'); if (brand && navLinks && overlap(brand, navLinks)) issues.push('Brand x Navigation');
  const hero = document.querySelector('.hero-slide.active .hero-content');
  if (hero && rect(hero).top < 100) issues.push('Hero-Inhalt unter der Topbar: top=' + Math.round(rect(hero).top));
  if (hero) { const d = document.querySelector('.hero-dots'); if (d && overlap(hero, d)) issues.push('Hero-Inhalt x Punkte'); }
  for (const t of document.querySelectorAll('.card .thumb')) { const b = t.querySelector('.badges'), p = t.querySelector('.progress'), c = t.querySelector('.corner'); if (b && p && overlap(b, p)) issues.push('Badges x Fortschritt'); if (b && c && overlap(b, c)) issues.push('Badges x Ecke'); }
  for (const s of document.querySelectorAll('.setting')) {
    const a = s.querySelector('.setting-text'), b = s.querySelector('.setting-control');
    if (a && b && overlap(a, b)) issues.push('Einstellung Text x Steuerung: ' + a.textContent.slice(0, 30));
    // Luecken: Text und Steuerung muessen nah beieinander liegen (keine riesigen Leerflaechen in Zeilen)
    if (a && b && s.classList.contains('wide')) { const gap = rect(b).top - rect(a).bottom; if (gap > 40) issues.push('Grosse Luecke in Einstellung (' + Math.round(gap) + 'px): ' + a.textContent.slice(0, 30)); }
    if (rect(s).height > 330) issues.push('Einstellungszeile ungewoehnlich hoch (' + Math.round(rect(s).height) + 'px): ' + s.textContent.slice(0, 30));
  }
  // Uneinheitliche Form: Buttons muessen Kapseln/Kreise sein
  for (const el of document.querySelectorAll('.btn, .opt')) { if (!vis(el)) continue; const r = parseFloat(getComputedStyle(el).borderTopLeftRadius); if (r < rect(el).height / 2 - 1) issues.push('Button nicht als Kapsel: ' + (el.textContent || '').trim().slice(0, 20) + ' r=' + r); }
  const head = document.querySelector('.detail-head');
  if (head) { const p = head.querySelector('.detail-poster'), i = head.querySelector('.detail-info'); if (p && i && overlap(p, i)) issues.push('Detail Poster x Info'); }
  for (const e of document.querySelectorAll('.ep')) { const t = e.querySelector('.ep-thumb'), i = e.querySelector('.ep-info'); if (t && i && overlap(t, i)) issues.push('Episode Bild x Info'); }
  const lib = document.querySelector('.lib-head'); if (lib) { const a = lib.querySelector('.lib-title'), b = lib.querySelector('.lib-controls'); if (a && b && overlap(a, b)) issues.push('Bibliothek Titel x Filter'); }
  for (const img of document.images) { if (img.complete && img.naturalWidth === 0 && vis(img) && !img.closest('.imgbox.failed')) issues.push('Bild nicht geladen: ' + (img.getAttribute('src') || '').slice(0, 60)); }
  // Horizontales Scrollen / abgeschnittene Inhalte
  const view = document.querySelector('#view');
  if (view && view.scrollWidth > view.clientWidth + 1) issues.push('Horizontales Scrollen im Inhalt: ' + view.scrollWidth + ' > ' + view.clientWidth);
  if (document.documentElement.scrollWidth > W + 1) issues.push('Dokument breiter als Fenster');
  for (const el of document.querySelectorAll('.btn, .opt, .tab, .nav-link, .seg')) { if (!vis(el)) continue; const r = rect(el); if (r.right > W + 1 || r.left < -1) issues.push('Ausserhalb des Fensters: ' + name(el) + ' ' + (el.textContent || '').trim().slice(0, 20)); }
  for (const el of document.querySelectorAll('.btn span, .opt .val, .tab, .nav-link')) { if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible' && el.children.length === 0) { const r = rect(el); const p = el.parentElement ? rect(el.parentElement) : r; if (r.right > p.right + 2) issues.push('Text ragt aus Container: ' + (el.textContent || '').trim().slice(0, 24)); } }
  return issues;
})()`;

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  setAdmin(true); // auch die Verwaltung pruefen (Schild-Knopf in der Kopfzeile, vier Bereiche)
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const libs = await ctx.run(`[...document.querySelectorAll('.nav-link')].map(a => a.getAttribute('href'))`);
  const movieHref = await ctx.run(`(async () => { location.hash = '${libs[1]}'; await new Promise(r => setTimeout(r, 1800)); return document.querySelector('.grid a.card').getAttribute('href'); })()`);
  const showHref = await ctx.run(`(async () => { location.hash = '${libs[2]}'; await new Promise(r => setTimeout(r, 1800)); return document.querySelector('.grid a.card').getAttribute('href'); })()`);
  const routes = [
    ['home', '#/home'],
    ['library', libs[1]],
    ['movie', movieHref],
    ['series', showHref],
    ['settings-appearance', '#/settings/appearance'],
    ['settings-home', '#/settings/home'],
    ['settings-video', '#/settings/video'],
    ['settings-audio', '#/settings/audio'],
    ['settings-subtitles', '#/settings/subtitles'],
    ['settings-behavior', '#/settings/behavior'],
    ['settings-network', '#/settings/network'],
    ['settings-general', '#/settings/general'],
    ['settings-discord', '#/settings/discord'],
    ['settings-account', '#/settings/account'],
    ['settings-about', '#/settings/about'],
    ['search', '#/search?q=a'],
    ['admin-server', '#/admin/server'],
    ['admin-tasks', '#/admin/tasks'],
    ['admin-sessions', '#/admin/sessions'],
    ['admin-users', '#/admin/users']
  ];
  const sizes = [[920, 620], [1280, 720], [1920, 1080]];
  let total = 0;
  for (const [w, h] of sizes) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(600);
    for (const [name, hash] of routes) {
      await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
      await ctx.wait(name === 'home' ? 2600 : 2000);
      const issues = await ctx.run(CHECK);
      total += issues.length;
      console.log(`[${w}x${h}] ${name}: ${issues.length ? '\n   - ' + [...new Set(issues)].join('\n   - ') : 'ok'}`);
      if (w === 920 || name === 'home' || name === 'library' || (w === 1280 && name.startsWith('settings'))) await ctx.capture(path.join(out, `L-${w}x${h}-${name}.png`));
    }
  }
  console.log(`Gefundene Probleme gesamt: ${total}`);
  server.close();
};
module.exports.CHECK = CHECK; // fuer weitere Pruefungen (audit-edge.js)
