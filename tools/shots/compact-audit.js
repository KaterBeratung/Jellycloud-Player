// Handy-Ansicht (kompakt) auf Abgeschnittenes absuchen: besucht viele Seiten in 360x740, 412x891 (OnePlus 7 Pro: 411x891 dp) und quer (800x411) in der Web-Fassung
// und meldet Text und Bedienelemente, die aus dem Bild ragen, von einem Rahmen mit overflow:hidden gekappt werden, Beschriftungen der Tab-Leiste, die nur noch mit "..." passen,
// Seitenenden unter der Tab-Leiste, Menues, die unten herausragen, und waagerechtes Scrollen. Aufnahmen der Seiten bei 412 px in SHOT_DIR.
const path = require('node:path');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');
const { server, items, setAdmin } = require('../mock-server');

const CHECK = `(() => {
  const issues = [];
  const W = innerWidth, H = innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const label = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName.toLowerCase()) + ' "' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26) + '"';
  const view = document.querySelector('#view');
  if (document.documentElement.dataset.compact !== 'on') issues.push('kompakte Ansicht ist nicht an');
  if (view && view.scrollWidth > view.clientWidth + 1) issues.push('Waagerechtes Scrollen im Inhalt: ' + view.scrollWidth + ' > ' + view.clientWidth);
  if (document.documentElement.scrollWidth > W + 1) issues.push('Dokument breiter als das Fenster');
  const SKIP = /^(svg|path|circle|rect|g|line|polyline|polygon|img|picture|source|use|defs|stop|lineargradient|radialgradient|clippath)$/i;
  const cands = [...document.querySelectorAll('#view *, .topbar *, .tabbar *, .menu *, .mdl *, .toast')].filter((el) => {
    if (SKIP.test(el.tagName) || !vis(el)) return false;
    if (el.closest('.hero-bg, .detail-bd, .imgbox, .ep-thumb, .thumb, [aria-hidden=true]')) return false;
    if (el.closest('details:not([open])') && !el.closest('summary')) return false; // zugeklappte Bereiche (Technik) werden nicht gezeichnet
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return direct || /^(button|a|input|select|textarea)$/i.test(el.tagName) || el.matches('.btn, .opt, .tab, .seg, .chip-btn, .tabbar-item, .switch');
  });
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    let scroller = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth + 1) { scroller = true; break; }
    }
    if (scroller) continue; // in einer waagerecht wischbaren Zeile ist Herausragen gewollt (Reihen, Reiter, Bereichsleiste)
    if (r.right > W + 1 || r.left < -1) { issues.push('Ausserhalb des Fensters: ' + label(el) + ' (x ' + Math.round(r.left) + '..' + Math.round(r.right) + ' von ' + W + ')'); continue; }
    for (let a = el.parentElement; a && a.id !== 'app'; a = a.parentElement) {
      if (/(hidden|clip)/.test(getComputedStyle(a).overflowX)) {
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1.5 || r.left < ar.left - 1.5) { issues.push('Abgeschnitten durch ' + label(a).slice(0, 44) + ': ' + label(el)); break; }
      }
    }
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.children.length === 0) issues.push('Text breiter als sein Behaelter: ' + label(el));
  }
  for (const t of document.querySelectorAll('.tabbar-item > span:last-child')) if (t.scrollWidth > t.clientWidth + 1) issues.push('Tab-Beschriftung nur mit "..." : ' + t.textContent.trim());
  for (const m of document.querySelectorAll('.menu.open')) { const r = m.getBoundingClientRect(); if (r.bottom > H + 1 || r.right > W + 1 || r.left < -1) issues.push('Menue ragt heraus: ' + Math.round(r.left) + '..' + Math.round(r.right) + ' x ' + Math.round(r.bottom) + ' (Fenster ' + W + 'x' + H + '; Klasse ' + m.className + ', top ' + m.style.top + ', Hoehe ' + Math.round(r.height) + ', max-height ' + getComputedStyle(m).maxHeight + ', Eintraege ' + m.querySelectorAll('.menu-item').length + ')'); }
  // Ende der Seite: liegt der letzte Inhalt unter der Tab-Leiste?
  const tab = document.querySelector('.tabbar');
  const page = view && view.querySelector('.page');
  if (tab && getComputedStyle(tab).display !== 'none' && page) {
    view.scrollTop = view.scrollHeight;
    let maxB = 0, maxEl = null;
    for (const el of page.querySelectorAll('*')) { if (!SKIP.test(el.tagName) && vis(el) && !el.closest('.detail-bd') && !(el.closest('details:not([open])') && !el.closest('summary'))) { const r = el.getBoundingClientRect(); if (r.top < H && r.bottom > maxB && el.children.length === 0) { maxB = r.bottom; maxEl = el; } } }
    if (maxB > tab.getBoundingClientRect().top + 1) issues.push('Ende der Seite liegt unter der Tab-Leiste (' + Math.round(maxB) + ' > ' + Math.round(tab.getBoundingClientRect().top) + '): ' + (maxEl ? label(maxEl) : '?') + ' in ' + (maxEl?.parentElement ? label(maxEl.parentElement).slice(0, 40) : '?') + '; Polster unten der Seite ' + getComputedStyle(page).paddingBottom + ', scrollHeight ' + view.scrollHeight);
    view.scrollTop = 0;
  }
  return issues;
})()`;

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
  setAdmin(true);
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(300);
  const win = new BrowserWindow({ width: 412, height: 891, useContentSize: true, show: true, backgroundColor: '#0a0b10', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  ctx.win.hide();
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  const ev = (js) => win.webContents.executeJavaScript(js);
  const dbg = () => {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    return (m, p) => win.webContents.debugger.sendCommand(m, p).catch(() => null);
  };
  const shot = async (name) => {
    try {
      const r = await dbg()('Page.captureScreenshot', { format: 'png' });
      if (r) fs.writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64'));
    } catch {
      /* Aufnahmen sind nur zum Ansehen */
    }
  };
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ev(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  await win.loadFile(path.join(__dirname, '..', '..', 'src', 'web', 'index.html'));
  {
    const d = dbg();
    await d('Page.bringToFront');
    await d('Emulation.setFocusEmulationEnabled', { enabled: true });
    await d('Page.setWebLifecycleState', { state: 'active' });
  }
  await ctx.wait(600);
  await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.home .rows .row')`, 15000);

  const libs = await ev(`[...document.querySelectorAll('.tabbar-item')].map((a) => a.getAttribute('href'))`);
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'The Winter Archive');
  const routes = [
    ['home', '#/home', null],
    ['library', libs[1], null],
    ['library-sort-menu', libs[1], `(() => { const b = [...document.querySelectorAll('.lib-controls .btn')].find((x) => /Sortier/.test(x.textContent)); b?.click(); })()`],
    ['library-genre-menu', libs[1], `(() => { const b = [...document.querySelectorAll('.lib-controls .btn')].find((x) => /Genre/.test(x.textContent)); b?.click(); })()`],
    ['movie', `#/item/${movie.Id}`, null],
    ['movie-technik', `#/item/${movie.Id}`, `document.querySelector('.tech')?.setAttribute('open', '')`],
    ['movie-mehr-menu', `#/item/${movie.Id}`, `document.querySelector('.detail-actions .btn[title]:last-of-type')?.click()`],
    ['series', `#/item/${show.Id}`, null],
    ['search', '#/search?q=a', null],
    ['settings-liste', '#/settings', null],
    ['settings-appearance', '#/settings/appearance', null],
    ['settings-home', '#/settings/home', null],
    ['settings-subtitles', '#/settings/subtitles', null],
    ['settings-behavior', '#/settings/behavior', null],
    ['settings-network', '#/settings/network', null],
    ['settings-general', '#/settings/general', null],
    ['settings-seerr', '#/settings/seerr', null],
    ['settings-account', '#/settings/account', null],
    ['settings-about', '#/settings/about', null],
    ['admin-server', '#/admin/server', null],
    ['admin-tasks', '#/admin/tasks', null],
    ['admin-sessions', '#/admin/sessions', null],
    ['admin-users', '#/admin/users', null]
  ];
  const sizes = [[412, 891], [360, 740], [800, 411]];
  let total = 0;
  for (const [w, h] of sizes) {
    win.setContentSize(w, h);
    await ctx.wait(700);
    for (const [name, hash, prep] of routes) {
      await ev(`location.hash = ${JSON.stringify(hash)}`);
      await ctx.wait(name === 'home' ? 2200 : 1500);
      if (prep) {
        await ev(prep);
        await ctx.wait(700);
      }
      const issues = [...new Set(await ev(CHECK))];
      total += issues.length;
      console.log(`[${w}x${h}] ${name}: ${issues.length ? '\n   - ' + issues.join('\n   - ') : 'ok'}`);
      if (w === 412) await shot(`C-${w}-${name}.png`);
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`).catch(() => null);
    }
  }
  console.log(`\nGefundene Probleme gesamt: ${total}`);
  win.destroy();
  server.close();
};
