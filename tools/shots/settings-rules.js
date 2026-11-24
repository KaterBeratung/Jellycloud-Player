// Einstellungen wie die Apple-App (Plan P23, 3.11, B2; JC_DEV=1, JC_FAKE_MPV=1): Bereiche in der Reihenfolge der Apple-App (Konto zuerst), ein
// Hinweis je Untertitelmodus, und was im gewaehlten Zusammenhang nicht wirkt, steht ausgeschaltet da und der Hinweis sagt warum (Untertitelsprache,
// Trailer, Pausenbildschirm, Bitratengrenze, WASAPI exklusiv, minimiert starten); Unteroptionen des Banners stehen nur mit Banner da.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/settings-rules.js
const path = require('node:path');
const { server } = require('../mock-server');

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
  const waitFor = async (js, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const open = async (section) => {
    await ctx.run(`location.hash = '#/settings/about'`);
    await waitFor(`!!document.querySelector('.snav.on[href="#/settings/about"]')`);
    await ctx.run(`location.hash = '#/settings/${section}'`);
    await waitFor(`!!document.querySelector('.snav.on[href="#/settings/${section}"]')`);
    await ctx.wait(400);
  };
  const row = (label) => `[...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === ${JSON.stringify(label)})`;
  const state = (label) =>
    ctx.run(`(() => { const r = ${row(label)}; if (!r) return null; const c = r.querySelector('.setting-control button, .setting-control input'); return { off: r.classList.contains('is-off'), disabled: !!c?.disabled, hidden: r.hidden || r.offsetParent === null, foot: r.closest('.settings-block')?.querySelector('.group-foot:not([hidden])')?.textContent ?? '' }; })()`);
  const clickSwitch = (label) => ctx.run(`${row(label)}?.querySelector('button.switch')?.click()`);
  const set = (patch) => ctx.run(`window.jc.setSettings(${JSON.stringify(patch)})`);

  // ---------- Reihenfolge der Bereiche ----------
  await ctx.run(`location.hash = '#/settings'`);
  await waitFor(`!!document.querySelector('.snav.on')`);
  const nav = await ctx.run(`({ order: [...document.querySelectorAll('.settings-nav .snav')].map((a) => a.getAttribute('href').split('/').pop()), active: document.querySelector('.snav.on')?.getAttribute('href') })`);
  check(
    'Bereiche in der Reihenfolge der Apple-App (Konto; Player = Wiedergabe, Untertitel, Netzwerk; Erscheinungsbild, Startseite; Seerr, Mitteilungen; Info), Windows-eigene dazwischen',
    JSON.stringify(nav.order) === JSON.stringify(['account', 'behavior', 'subtitles', 'network', 'video', 'audio', 'appearance', 'home', 'seerr', 'notifications', 'discord', 'general', 'about']),
    nav.order.join(' ')
  );
  check('Ohne Bereich in der Adresse ist das Konto offen (der erste Bereich)', nav.active === '#/settings/account', nav.active);

  // ---------- Untertitel: Hinweis je Modus, Sprache nur wo sie wirkt ----------
  await set({ player: { subtitleMode: 'server' } });
  await open('subtitles');
  const s1 = await state('Untertitelsprache');
  check('"Wie auf dem Server": Untertitelsprache ausgeschaltet, der Hinweis sagt, dass Jellyfin waehlt und wo man die Sprache einstellt', s1?.off && s1.disabled && /Jellyfin nach den Untertitel-Einstellungen/.test(s1.foot) && /Einstellungen › Untertitel/.test(s1.foot), JSON.stringify(s1));
  await ctx.capture(path.join(out, 'SR-untertitel-server.png'));
  await ctx.run(`${row('Untertitelsprache')}?.querySelector('button')?.click()`);
  await ctx.wait(300);
  check('...die ausgeschaltete Zeile nimmt nichts an (kein Menue)', (await ctx.run(`!document.querySelector('.menu.open')`)) === true);
  const pickMode = async (name) => {
    await ctx.run(`${row('Untertitel-Modus')}?.querySelector('button')?.click()`);
    await waitFor(`!!document.querySelector('.menu.open')`, 2000);
    await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))?.click()`);
    await waitFor(`!document.querySelector('.menu.open')`, 2000);
    await ctx.wait(200);
  };
  await pickMode('Immer');
  const s2 = await state('Untertitelsprache');
  check('"Immer": Untertitelsprache bedienbar, der Hinweis beschreibt den Modus ohne Grund zum Ausschalten', s2 && !s2.off && !s2.disabled && /Volle Untertitel in der gewählten Untertitelsprache/.test(s2.foot) && !/gilt hier nicht/.test(s2.foot), JSON.stringify(s2));
  check('...gespeichert', await waitFor(`window.jc.getState().then((s) => s.settings.player.subtitleMode === 'always')`, 3000));
  await pickMode('Aus');
  const s3 = await state('Untertitelsprache');
  check('"Aus": Untertitelsprache ausgeschaltet, "Ohne Untertitel gilt auch keine Untertitelsprache."', s3?.off && s3.disabled && /Ohne Untertitel gilt auch keine Untertitelsprache/.test(s3.foot), JSON.stringify(s3));
  await set({ player: { subtitleMode: 'server' } });

  // ---------- Ueberspringen (P22, E-P8): "Automatisch springen" nur, wenn ein Abschnitt auf "Automatisch" steht ----------
  await open('behavior');
  const k1 = await state('Automatisch springen');
  check('Standard (nichts auf "Automatisch"): "Automatisch springen" ausgeschaltet, mit Satz', k1?.off && k1.disabled && /gilt nur für Abschnitte auf „Automatisch“/.test(k1.foot), JSON.stringify(k1));
  const pickSeg = (label, text) => ctx.run(`[...(${row(label)}?.querySelectorAll('.seg') ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  await pickSeg('Intro', 'Automatisch');
  await ctx.wait(300);
  const k2 = await state('Automatisch springen');
  check('Intro "Automatisch": "Automatisch springen" bedienbar, ohne den Satz', k2 && !k2.off && !k2.disabled && !/gilt nur für Abschnitte/.test(k2.foot), JSON.stringify(k2));
  await pickSeg('Intro', 'Knopf zeigen');
  await ctx.wait(300);

  // ---------- Trailer und Pausenbildschirm (umgeschaltet wie vom Nutzer: setSettings ginge am Zustand der Oberflaeche vorbei) ----------
  await clickSwitch('Trailer automatisch abspielen');
  await clickSwitch('Pausenbildschirm zeigen');
  await ctx.wait(300);
  const tr = await ctx.run(`(() => { const block = ${row('Trailer automatisch abspielen')}?.closest('.settings-block'); const rows = [...(block?.querySelectorAll('.setting') ?? [])].slice(1); return { n: rows.length, off: rows.filter((r) => r.classList.contains('is-off')).length, foot: block?.querySelector('.group-foot:not([hidden])')?.textContent ?? '' }; })()`);
  check('Trailer aus: die uebrigen Trailer-Zeilen sind ausgeschaltet, der Hinweis sagt warum', tr.n >= 6 && tr.off === tr.n && /gelten nur, wenn „Trailer automatisch abspielen“ an ist/.test(tr.foot), JSON.stringify(tr));
  await clickSwitch('Trailer automatisch abspielen');
  await ctx.wait(300);
  const tr2 = await ctx.run(`(() => { const block = ${row('Trailer automatisch abspielen')}?.closest('.settings-block'); const rows = [...block.querySelectorAll('.setting')].slice(1); return { off: rows.filter((r) => r.classList.contains('is-off')).length, foot: block.querySelector('.group-foot:not([hidden])')?.textContent ?? '' }; })()`);
  check('...eingeschaltet: alle bedienbar, kein Hinweis', tr2.off === 0 && tr2.foot === '', JSON.stringify(tr2));
  const p1 = await state('Anzeigen nach');
  check('Pausenbildschirm aus: "Anzeigen nach" ausgeschaltet, mit Satz', p1?.off && p1.disabled && /gilt nur, wenn „Pausenbildschirm zeigen“ an ist/.test(p1.foot), JSON.stringify(p1));
  await clickSwitch('Pausenbildschirm zeigen');
  await ctx.wait(300);
  const p2 = await state('Anzeigen nach');
  check('...eingeschaltet: bedienbar', p2 && !p2.off && !p2.disabled && p2.foot === '', JSON.stringify(p2));
  await ctx.capture(path.join(out, 'SR-wiedergabe.png'));
  check('Gespeichert: Trailer und Pausenbildschirm wieder an', await waitFor(`window.jc.getState().then((s) => s.settings.trailer.autoplay === true && s.settings.player.pauseScreen === true)`, 3000));

  // ---------- Netzwerk, Ton, Allgemein (Passthrough und Autostart sind im Standard aus) ----------
  await open('network');
  await clickSwitch('Transcoding erlauben');
  await ctx.wait(300);
  const q1 = await state('Bitratengrenze');
  check('Ohne "Transcoding erlauben": Bitratengrenze ausgeschaltet, mit Satz', q1?.off && q1.disabled && /die Bitratengrenze gilt dann nicht/.test(q1.foot), JSON.stringify(q1));
  await clickSwitch('Transcoding erlauben');
  await ctx.wait(300);
  const q2 = await state('Bitratengrenze');
  check('...mit Transcoding: bedienbar', q2 && !q2.off && !q2.disabled, JSON.stringify(q2));
  await open('audio');
  const a1 = await state('WASAPI exklusiv');
  check('Ohne Passthrough: "WASAPI exklusiv" ausgeschaltet, mit Satz', a1?.off && a1.disabled && /gilt nur mit „Audio-Passthrough“/.test(a1.foot), JSON.stringify(a1));
  await clickSwitch('Audio-Passthrough');
  await ctx.wait(300);
  const a2 = await state('WASAPI exklusiv');
  check('...mit Passthrough: bedienbar', a2 && !a2.off && !a2.disabled && a2.foot === '', JSON.stringify(a2));
  await clickSwitch('Audio-Passthrough');
  await open('general');
  const g1 = await state('Minimiert starten');
  check('Ohne "Mit Windows starten": "Minimiert starten" ausgeschaltet, mit Satz', g1?.off && g1.disabled && /gilt nur, wenn „Mit Windows starten“ an ist/.test(g1.foot), JSON.stringify(g1));

  // ---------- Startseite: Unteroptionen nur mit Banner ----------
  await open('home');
  const h1 = await ctx.run(`({ auto: !!${row('Banner wechselt automatisch')} && ${row('Banner wechselt automatisch')}.offsetParent !== null, slides: !!${row('Folien im Banner')} && ${row('Folien im Banner')}.offsetParent !== null })`);
  check('Banner an: "Banner wechselt automatisch" und "Folien im Banner" stehen da', h1.auto && h1.slides, JSON.stringify(h1));
  await clickSwitch('Banner anzeigen');
  await ctx.wait(300);
  const h2 = await ctx.run(`({ auto: ${row('Banner wechselt automatisch')}?.offsetParent !== null, slides: ${row('Folien im Banner')}?.offsetParent !== null })`);
  check('Banner aus: beide Unteroptionen verschwinden (wie "Folien" in der Apple-App)', !h2.auto && !h2.slides, JSON.stringify(h2));
  await clickSwitch('Banner anzeigen');
  await ctx.wait(300);
  check('Banner wieder an: gespeichert, Unteroptionen wieder da', (await waitFor(`window.jc.getState().then((s) => s.settings.home.hero === true)`, 3000)) && (await ctx.run(`${row('Folien im Banner')}?.offsetParent !== null`)) === true);

  check('Keine Konsolenfehler oder -warnungen', errors.length === 0, errors.slice(0, 4).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
