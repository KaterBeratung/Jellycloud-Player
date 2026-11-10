// Audit der Menues und Dialoge in drei Fenstergroessen (JC_DEV=1, JC_FAKE_MPV=1): passen sie ins Fenster, ragt etwas heraus, gibt es Konsolenfehler?
// Prueft Untertitel-Menue (kurz und aufgeklappt), "Mehr"-Menue mit Verwalten, Rueckfrage, Benutzer anlegen, Passwort, Bearbeiten, Identifizieren.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/audit-dialogs.js
const path = require('node:path');
const { server, items, setAdmin } = require('../mock-server');

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
  setAdmin(true);
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
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
  const press = (key) => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);

  // Film mit vielen Untertiteln
  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const base = movie.MediaSources[0].MediaStreams.filter((s) => s.Type !== 'Subtitle');
  const sub = (Index, Language, extra = {}) => ({ Index, Type: 'Subtitle', Codec: 'subrip', Language, DisplayTitle: `${Language ?? 'und'} - SubRip`, ...extra });
  const langs = ['ger', 'eng', 'fre', 'spa', 'ita', 'por', 'pol', 'rus', 'tur', 'jpn', 'kor', 'dut', 'swe', 'dan', 'fin', 'cze', 'hun', 'ara', 'heb', 'gre'];
  movie.MediaSources[0].MediaStreams.splice(0, movie.MediaSources[0].MediaStreams.length, ...base, ...langs.map((l, i) => sub(10 + i, l)), sub(40, 'ger', { IsForced: true }), sub(41, 'ger', { Title: 'Deutsch (SDH)' }), sub(42, 'eng', { Title: 'English SDH' }));

  // Pruefungen im Browserfenster: Element liegt ganz im Fenster, nichts ragt waagerecht heraus, Knoepfe sichtbar
  const fitCheck = (sel) => `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = els.at(-1); if (!el) return 'nicht da';
    const r = el.getBoundingClientRect(); const issues = [];
    if (r.left < 4 || r.right > innerWidth - 4) issues.push('waagerecht: ' + Math.round(r.left) + '..' + Math.round(r.right) + ' von ' + innerWidth);
    if (r.top < 4 || r.bottom > innerHeight - 4) issues.push('senkrecht: ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' von ' + innerHeight);
    if (el.scrollWidth > el.clientWidth + 1) issues.push('Inhalt breiter als das Fenster (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
    for (const b of el.querySelectorAll('.mdl-actions button')) { const x = b.getBoundingClientRect(); if (x.bottom > r.bottom + 0.5 || x.right > r.right + 0.5 || x.left < r.left - 0.5) issues.push('Knopf ragt heraus: ' + b.textContent.trim()); if (x.width < 40 || x.height < 28) issues.push('Knopf zu klein: ' + b.textContent.trim()); }
    for (const i of el.querySelectorAll('.mdl-body *')) { if (i.children.length === 0 && i.scrollWidth > i.clientWidth + 2 && getComputedStyle(i).overflow === 'visible' && i.getBoundingClientRect().right > r.right + 1) issues.push('Text ragt heraus: ' + (i.textContent || '').trim().slice(0, 30)); }
    return issues.join('; ') || 'ok';
  })()`;
  const fit = async (label, sel) => {
    const r = await ctx.run(fitCheck(sel));
    check(label, r === 'ok', r === 'ok' ? '' : r);
  };
  const clickText = (sel, re) => ctx.run(`[...[...document.querySelectorAll(${JSON.stringify(sel.split(' ')[0])})].at(-1).querySelectorAll(${JSON.stringify(sel.split(' ').slice(1).join(' '))})].find((b) => ${re}.test(b.textContent))?.click()`);

  for (const [w, h] of [[920, 620], [1280, 720], [1920, 1080]]) {
    const tag = `${w}x${h}`;
    ctx.win.setContentSize(w, h);
    await ctx.wait(700);
    await ctx.run(`location.hash = '#/item/${movie.Id}'`);
    await waitFor(`!!document.querySelector('.detail-options')`, 10000);
    await ctx.wait(900);

    // Untertitel-Menue
    await ctx.run(`[...document.querySelectorAll('.detail-options .opt')].find((b) => /Untertitel/.test(b.textContent)).click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(400);
    await fit(`[${tag}] Untertitel-Menue (kurz) passt ins Fenster`, '.menu');
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-untertitel-kurz.png`));
    await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /Weitere Sprachen/.test(b.textContent)).click()`);
    await ctx.wait(600);
    await fit(`[${tag}] Untertitel-Menue (aufgeklappt, ${langs.length} Sprachen) passt ins Fenster`, '.menu');
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-untertitel-alle.png`));
    await press('Escape');
    await ctx.wait(350);

    // "Mehr" mit Verwalten
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(400);
    await fit(`[${tag}] Menue "Mehr" mit Verwalten passt ins Fenster`, '.menu');
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-mehr.png`));
    // Bearbeiten
    await clickText('.menu .menu-item', '/Metadaten bearbeiten/');
    await waitFor(`!!document.querySelector('.mdl')`, 3000);
    await ctx.wait(500);
    await fit(`[${tag}] Bearbeiten-Fenster passt ins Fenster (Knoepfe sichtbar)`, '.mdl');
    check(`[${tag}] Bearbeiten: bei wenig Platz scrollt der Inhalt im Fenster, nicht die Seite`, await ctx.run(`(() => { const m = document.querySelector('.mdl'); const b = m.querySelector('.mdl-body'); return m.getBoundingClientRect().height <= innerHeight * 0.9 + 1 && (b.scrollHeight <= b.clientHeight + 1 || getComputedStyle(b).overflowY === 'auto'); })()`));
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-bearbeiten.png`));
    await press('Escape');
    await ctx.wait(400);
    // Identifizieren
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(300);
    await clickText('.menu .menu-item', '/Identifizieren/');
    await waitFor(`!!document.querySelector('.mdl-search')`, 3000);
    await ctx.run(`document.querySelector('.mdl-search .btn').click()`);
    await waitFor(`document.querySelectorAll('.mdl-result').length === 2`, 5000);
    await ctx.wait(300);
    await fit(`[${tag}] Identifizieren-Fenster mit Treffern passt ins Fenster`, '.mdl');
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-identifizieren.png`));
    await press('Escape');
    await ctx.wait(400);
    // Loeschen-Rueckfrage
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(300);
    await clickText('.menu .menu-item', '/Vom Server löschen/');
    await waitFor(`!!document.querySelector('.mdl')`, 3000);
    await ctx.wait(400);
    await fit(`[${tag}] Loeschen-Rueckfrage passt ins Fenster`, '.mdl');
    await press('Escape');
    await ctx.wait(400);

    // Benutzer: Dialog "anlegen" und das Menue eines Benutzers
    await ctx.run(`location.hash = '#/admin/users'`);
    await waitFor(`document.querySelectorAll('.admin-user').length > 0`, 5000);
    await ctx.wait(600);
    await ctx.run(`[...document.querySelectorAll('.admin .btn')].find((b) => /Benutzer anlegen/.test(b.textContent)).click()`);
    await waitFor(`!!document.querySelector('.mdl')`, 3000);
    await ctx.wait(400);
    await fit(`[${tag}] Benutzer-anlegen-Fenster passt ins Fenster`, '.mdl');
    if (w === 920) await ctx.capture(path.join(out, `D-${tag}-benutzer-anlegen.png`));
    await press('Escape');
    await ctx.wait(400);
    await ctx.run(`document.querySelector('[data-user="lena"] button').click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(400);
    await fit(`[${tag}] Menue eines Benutzers passt ins Fenster`, '.menu');
    await press('Escape');
    await ctx.wait(350);
  }

  // Kleinstes Fenster: Kopfzeile mit Marke, Navigation, fuenf Scheiben (Administrator)
  ctx.win.setContentSize(920, 620);
  await ctx.wait(500);
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(2500);
  check('[920x620] Kopfzeile: Marke, Navigation und Werkzeuge ueberlappen nicht und passen nebeneinander', await ctx.run(`(() => { const a = document.querySelector('.navrow-start .brand').getBoundingClientRect(), b = document.querySelector('.navpill').getBoundingClientRect(), c = document.querySelector('.toolpill').getBoundingClientRect(); return a.right + 8 <= b.left && b.right + 8 <= c.left && c.right <= innerWidth - 8; })()`), await ctx.run(`JSON.stringify(['.navrow-start .brand', '.navpill', '.toolpill'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }))`));
  await ctx.capture(path.join(out, 'D-920x620-home-admin.png'));

  check('Keine Konsolenfehler oder -warnungen', errors.length === 0, errors.slice(0, 5).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
