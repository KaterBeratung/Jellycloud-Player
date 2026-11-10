// Einstellungen wirken sofort (JC_DEV=1, JC_FAKE_MPV=1): Startseite und Bibliothek bleiben beim Verlassen im Speicher; was sie beim Aufbau aus den Einstellungen lesen
// (Banner wechselt, Badges, Trailer, Spoiler-Schutz), muss beim naechsten Besuch neu gelten, ohne dass man neu laden muss. Reine Darstellung wirkt per CSS und laesst die Seiten in Ruhe.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/settings-live.js
const path = require('node:path');
const { server } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
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
  const go = async (hash) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await ctx.wait(500);
  };
  const toggleSetting = (label) => ctx.run(`[...document.querySelectorAll('.setting')].find((s) => ${label}.test(s.querySelector('.setting-label')?.textContent ?? ''))?.querySelector('button.switch')?.click()`);
  const isOn = (label) => ctx.run(`!![...document.querySelectorAll('.setting')].find((s) => ${label}.test(s.querySelector('.setting-label')?.textContent ?? ''))?.querySelector('button.switch.on')`);
  const libHref = await ctx.run(`[...document.querySelectorAll('.nav-link')].map((a) => a.getAttribute('href'))[1]`);

  // Startseite und Bibliothek aufbauen und damit in den Speicher des Routers legen
  await go('#/home');
  check('Startseite: das Banner wechselt von selbst (Zeitbalken laeuft)', await waitFor(`!!document.querySelector('.hero-dots .dot.run')`, 8000));
  check('Startseite: Reihen mit Qualitaets-Badges', await waitFor(`document.querySelectorAll('.rows .card .badges').length > 0`, 5000));
  await go(libHref);
  check('Bibliothek: Karten mit Badges', await waitFor(`document.querySelectorAll('.grid .card .badges').length > 0`, 6000));
  await ctx.run(`document.querySelector('.grid').dataset.mark = 'alt'`);

  // ---------- Reine Darstellung laesst die Seiten im Speicher ----------
  await go('#/settings/appearance');
  await ctx.run(`document.querySelector('[data-theme-id="graphite"]').click()`);
  check('Theme wechseln wirkt sofort auf das ganze Fenster', await waitFor(`document.documentElement.dataset.theme === 'graphite'`, 2000));
  await ctx.wait(500);
  await ctx.run(`document.querySelector('[data-theme-id="midnight"]').click()`);
  await ctx.wait(400);
  await go(libHref);
  check('Ein reines Darstellungs-Setting (Theme) laesst die Bibliothek im Speicher (kein Neuaufbau, Scrollposition bleibt)', await ctx.run(`document.querySelector('.grid')?.dataset.mark === 'alt'`));

  // ---------- Banner wechselt automatisch ----------
  await go('#/settings/home');
  check('Einstellung "Banner wechselt automatisch" ist an (Einstellungen > Startseite)', await isOn('/Banner wechselt automatisch/'));
  await toggleSetting('/Banner wechselt automatisch/');
  await ctx.wait(400);
  await go('#/home');
  check('Banner aus: die Startseite zeigt es sofort ohne Zeitbalken (ohne Neuladen)', (await waitFor(`!!document.querySelector('.hero-slide.active')`, 6000)) && (await ctx.run(`!document.querySelector('.hero-dots .dot.run')`)));
  await go('#/settings/home');
  await toggleSetting('/Banner wechselt automatisch/');
  await ctx.wait(400);
  await go('#/home');
  check('Banner wieder an: der Zeitbalken laeuft wieder', await waitFor(`!!document.querySelector('.hero-dots .dot.run')`, 6000));

  // ---------- Badges ----------
  await go('#/settings/appearance');
  await toggleSetting('/Qualitäts-Badges/');
  await ctx.wait(400);
  await go('#/home');
  check('Badges aus: die Reihen der Startseite zeigen keine mehr (ohne Neuladen)', (await waitFor(`document.querySelectorAll('.rows .card').length > 0`, 6000)) && (await ctx.run(`document.querySelectorAll('.rows .card .badges').length === 0`)));
  await go(libHref);
  check('Badges aus: auch die (vorher im Speicher gehaltene) Bibliothek zeigt keine mehr', (await waitFor(`document.querySelectorAll('.grid .card').length > 0`, 6000)) && (await ctx.run(`document.querySelectorAll('.grid .card .badges').length === 0 && document.querySelector('.grid')?.dataset.mark !== 'alt'`)));
  await ctx.capture(path.join(out, 'SL-badges-aus.png'));
  await go('#/settings/appearance');
  await toggleSetting('/Qualitäts-Badges/');
  await ctx.wait(400);
  await go('#/home');
  check('Badges wieder an: sofort wieder da', await waitFor(`document.querySelectorAll('.rows .card .badges').length > 0`, 6000));

  // ---------- Trailer ----------
  await ctx.run(`document.querySelector('.home').dataset.mark = 'alt'`);
  await go('#/settings/behavior');
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Auch auf der Startseite/.test(s.textContent))?.scrollIntoView({ block: 'center' })`);
  await toggleSetting('/Auch auf der Startseite/');
  await ctx.wait(500);
  check('Trailer-Einstellung "Auch auf der Startseite" ist gespeichert', ctx.config.settings.trailer.home === false, String(ctx.config.settings.trailer.home));
  await go('#/home');
  check('Trailer-Einstellung geaendert: die Startseite wird neu aufgebaut und liest sie neu (nicht die alte Ansicht aus dem Speicher)', (await waitFor(`!!document.querySelector('.hero-slide.active')`, 6000)) && (await ctx.run(`document.querySelector('.home')?.dataset.mark !== 'alt'`)));
  await go('#/settings/behavior');
  await toggleSetting('/Auch auf der Startseite/');
  await ctx.wait(300);

  // ---------- Stil beim Ausblenden (Ecke oder Poster) ----------
  await go('#/settings/behavior');
  const styleRow = () => ctx.run(`(() => { const s = [...document.querySelectorAll('.setting')].find((x) => /Stil beim Ausblenden/.test(x.querySelector('.setting-label')?.textContent ?? '')); return s ? [...s.querySelectorAll('.seg')].map((b) => b.textContent.trim() + (b.classList.contains('on') ? '*' : '')) : null; })()`);
  check('Einstellungen > Trailer: "Stil beim Ausblenden" mit "Logo in die Ecke" (Standard) und "Poster bleibt"', (await styleRow())?.join('|') === 'Logo in die Ecke*|Poster bleibt', JSON.stringify(await styleRow()));
  await ctx.run(`[...[...document.querySelectorAll('.setting')].find((x) => /Stil beim Ausblenden/.test(x.querySelector('.setting-label')?.textContent ?? '')).querySelectorAll('.seg')].find((b) => /Poster bleibt/.test(b.textContent)).click()`);
  await ctx.wait(500);
  check('Auswahl "Poster bleibt" wird gespeichert', ctx.config.settings.trailer.focusStyle === 'poster', String(ctx.config.settings.trailer.focusStyle));
  await ctx.run(`[...[...document.querySelectorAll('.setting')].find((x) => /Stil beim Ausblenden/.test(x.querySelector('.setting-label')?.textContent ?? '')).querySelectorAll('.seg')].find((b) => /Logo in die Ecke/.test(b.textContent)).click()`);
  await ctx.wait(500);
  check('...und "Logo in die Ecke" wieder zurueck', ctx.config.settings.trailer.focusStyle === 'corner');

  // ---------- Gespeichert wird es auch (ueberlebt ein Neuladen der Oberflaeche) ----------
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  check('Nach dem Neuladen gelten dieselben Werte (Badges an, Banner an, Trailer auf der Startseite an)', ctx.config.settings.appearance.showBadges === true && ctx.config.settings.appearance.heroAutoplay === true && ctx.config.settings.trailer.home === true);

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
