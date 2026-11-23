// "Auf diesem Geraet fortsetzen" (P19, nach HandoffOffer, RemoteControlChannel und den zwoelf Regeln der Apple-App), Mock-Server mit WebSocket auf Port 8983:
//  Quelle: waehrend der Wiedergabe Steuerung angemeldet und Kanal offen (Token nur im Kopf, Lebenszeichen), Pause/Fortsetzen/Wechsel von aussen, Unlesbares
//          uebergangen, Stopp von einem anderen Geraet schliesst wie der eigene Knopf (genaue Stelle), danach Kanal zu und Steuerung abgemeldet
//  Ziel:   Kapsel auf der Startseite (Geraet, Titel), Abfrage alle 5 s nur auf der Startseite, fremde Konten nie, Antippen haelt dort an und spielt hier an der
//          gemeldeten Stelle weiter; mehrere Geraete: Auswahl; anderer Titel oder nicht steuerbar: Meldung, nichts startet; Einstellung aus: keine Abfrage
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/handoff.js
const path = require('node:path');
const { server, state, items, TOKEN, USER } = require('../mock-server');

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
  const PORT = 8983;
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
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(60);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 9000);
    await ctx.wait(300);
  };
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' }).then((r) => r.json());
  const logAt = (at) => state.log.filter((l) => l.at === at);
  const polls = () => logAt('GET /Sessions').length;
  const movies = [...items.values()].filter((i) => i.Type === 'Movie' && i.MediaSources?.length);
  const [movieA, movieB] = movies;
  const auth = `MediaBrowser Client="Test", Device="Zweitgeraet", DeviceId="zweitgeraet", Version="1", Token="${TOKEN}"`;
  const sessionsNow = () => fetch(`${BASE}/Sessions?ControllableByUserId=${USER.Id}&ActiveWithinSeconds=90`, { headers: { Authorization: auth } }).then((r) => r.json());

  // ================= Quelle: dieses Geraet spielt, ein anderes steuert =================
  state.log.length = 0;
  const playErr = await ctx.run(`window.jc.play({ itemId: '${movieA.Id}', resume: false }).then(() => null, (e) => e.message)`);
  const started = await until(() => ctx.player.active && logAt('/Sessions/Playing').length > 0, 15000);
  check('Wiedergabe laeuft (Testplayer)', !playErr && started, playErr ?? '');
  const upgraded = await until(() => logAt('socket:upgrade').length > 0, 6000);
  const caps = logAt('/Sessions/Capabilities/Full').at(-1);
  const up = logAt('socket:upgrade')[0];
  check('Waehrend der Wiedergabe: Steuerung angemeldet (SupportsMediaControl) und Steuerkanal /socket offen', upgraded && caps?.SupportsMediaControl === true && up?.path === '/socket', JSON.stringify({ caps: caps?.SupportsMediaControl, up }));
  const selfClient = (await sessionsNow()).find((s) => s.DeviceId === up?.deviceId)?.Client;
  check('...das Token nur im Kopf, nie in der Adresse; Programmname "Jellycloud"', up?.authHeader === true && up?.tokenInUrl === false && selfClient === 'Jellycloud', JSON.stringify({ ...up, client: selfClient }));
  check('...auf die Forderung nach Lebenszeichen antwortet die App', await until(() => logAt('socket:KeepAlive').length > 0, 4000));
  const self = (await sessionsNow()).find((s) => s.DeviceId === up?.deviceId);
  check('Fuer andere Geraete steuerbar: die eigene Sitzung mit SupportsRemoteControl und dem laufenden Titel', self?.SupportsRemoteControl === true && self?.NowPlayingItem?.Id === movieA.Id, JSON.stringify(self));
  await until(() => ctx.player.state.phase === 'playing', 6000);
  await debug('socket?command=Pause');
  check('Pause von aussen: haelt an', await until(() => ctx.player.state.paused === true, 4000));
  await debug('socket?command=Unpause');
  check('Unpause: laeuft weiter', await until(() => ctx.player.state.paused === false, 4000));
  await debug('socket?command=PlayPause');
  check('PlayPause: wechselt', await until(() => ctx.player.state.paused === true, 4000));
  await debug('socket?command=PlayPause');
  await until(() => ctx.player.state.paused === false, 4000);
  await debug(`socket?send=${encodeURIComponent('kein JSON')}`);
  await debug('socket?command=Seek');
  await debug(`socket?send=${encodeURIComponent('{"MessageType":"Play","Data":{"ItemIds":["x"],"PlayCommand":"PlayNow"}}')}`);
  await ctx.wait(600);
  check('Unlesbares, Springen und Abspielen von aussen werden uebergangen', ctx.player.active && ctx.player.state.paused === false && ctx.player.cur?.item.Id === movieA.Id);
  await ctx.wait(1500); // ein Stueck Wiedergabe, damit die Stelle nicht null ist
  const r = await fetch(`${BASE}/Sessions/${self?.Id}/Playing/Stop`, { method: 'POST', headers: { Authorization: auth } });
  const closed = await until(() => !ctx.player.active, 6000);
  const stopped = logAt('/Sessions/Playing/Stopped').at(-1);
  check('Stopp von einem anderen Geraet: der Player schliesst wie ueber seinen Knopf und meldet die genaue Stelle', r.status === 204 && closed && stopped?.ItemId === movieA.Id && stopped?.PositionTicks > 0, JSON.stringify(stopped));
  check('...danach Kanal zu und Steuerung abgemeldet', await until(() => logAt('socket:close').length > 0 && logAt('/Sessions/Capabilities/Full').at(-1)?.SupportsMediaControl === false, 5000));
  await ctx.wait(400);
  check('...und die Sitzung ist nicht mehr steuerbar (kein Kanal, nichts angeboten)', !(await sessionsNow()).some((s) => s.DeviceId === up?.deviceId));

  // ================= Ziel: ein anderes Geraet spielt, dieses uebernimmt =================
  await debug('session?clear=1');
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  await ctx.wait(500);
  const capsule = () => ctx.run(`(() => { const e = document.querySelector('.handoff'); if (!e || e.hidden || !e.classList.contains('in')) return null; const r = e.getBoundingClientRect(); return { title: e.querySelector('.handoff-title')?.textContent, detail: e.querySelector('.handoff-detail')?.textContent, label: e.querySelector('.handoff-btn')?.getAttribute('aria-label'), w: Math.round(r.width), bottom: Math.round(innerHeight - r.bottom), cx: Math.round(r.left + r.width / 2 - innerWidth / 2), pad: document.querySelector('.home').classList.contains('has-handoff') }; })()`);
  check('Ohne andere Wiedergabe: keine Kapsel', (await capsule()) === null);
  const p0 = polls();
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieB.Id}&at=120`);
  await debug(`session?device=${encodeURIComponent('Fremdes Tablet')}&item=${movieA.Id}&user=other&at=300`);
  const shown = await until(async () => !!(await capsule()), 8000);
  await ctx.wait(500); // die Kapsel gleitet herein: erst danach messen
  const c1 = await capsule();
  check('Spielt ein anderes Geraet des Kontos: Kapsel "Auf diesem Geraet fortsetzen" mit Titel und Geraet', shown && c1.title === 'Auf diesem Gerät fortsetzen' && c1.detail === `${movieB.Name} · Wohnzimmer Apple TV`, JSON.stringify(c1));
  check('...das fremde Konto erscheint nicht (keine "weitere")', !/weitere/.test(c1?.detail ?? '') && !/Fremdes/.test(JSON.stringify(c1)));
  check('...unten mittig, hoechstens 460 breit; die Startseite bekommt am Ende Platz', c1 && c1.w <= 460 && c1.w >= 300 && Math.abs(c1.cx) <= 2 && c1.bottom >= 16 && c1.pad, JSON.stringify(c1));
  check('...fuer Bildschirmleser benannt', /Auf diesem Gerät fortsetzen: .+, läuft auf Wohnzimmer Apple TV/.test(c1?.label ?? ''), c1?.label);
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'HO-01-kapsel.png'));
  const t0 = polls();
  await ctx.wait(11000);
  const n11 = polls() - t0;
  check('Abfrage alle 5 s, solange die Startseite vorne ist', n11 >= 2 && n11 <= 3 && p0 < polls(), `${n11} Abfragen in 11 s`);

  // Antippen: dort anhalten, hier an der gemeldeten Stelle weiter
  state.log.length = 0;
  await ctx.run(`document.querySelector('.handoff-btn').click()`);
  const tookOver = await until(() => ctx.player.active && logAt('PlaybackInfo').length > 0, 10000);
  const stop1 = logAt('RemoteStop')[0];
  const plan = logAt('PlaybackInfo')[0];
  const order = state.log.map((l) => l.at).filter((a) => ['GET /Sessions', 'RemoteStop', 'PlaybackInfo'].includes(a));
  check('Antippen: erst frisch gelesen, dann dort angehalten, dann hier gestartet', tookOver && JSON.stringify(order.slice(0, 3)) === JSON.stringify(['GET /Sessions', 'RemoteStop', 'PlaybackInfo']), JSON.stringify(order));
  check('...hier an der Stelle, die das andere Geraet beim Stopp gemeldet hat', !!plan && plan.itemId === movieB.Id && plan.startTicks === stop1?.PositionTicks && plan.startTicks >= 120 * 1e7, JSON.stringify({ plan: plan?.startTicks, stop: stop1?.PositionTicks }));
  check('...waehrend der Wiedergabe keine Kapsel', (await capsule()) === null);
  const duringPlay = polls();
  await ctx.wait(6000);
  check('...und keine Abfrage, solange hier gespielt wird', polls() === duringPlay, `${polls() - duringPlay} Abfragen`);
  await ctx.player.stop();
  await until(() => !ctx.player.active, 5000);
  await ctx.wait(800);

  // Zwei Geraete: Auswahl
  await debug('session?clear=1');
  await go('#/movies', `!!document.querySelector('.library')`);
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieB.Id}&at=200`);
  await debug(`session?device=${encodeURIComponent('iPad Air')}&item=${movieA.Id}&at=400&idle=20`);
  await until(async () => /weitere/.test((await capsule())?.detail ?? ''), 8000);
  const c2 = await capsule();
  check('Zwei Geraete: die juengste Meldung vorn, "und 1 weitere"', c2?.detail === `${movieB.Name} und 1 weitere`, JSON.stringify(c2));
  await ctx.run(`document.querySelector('.handoff-btn').click()`);
  const chooser = await waitFor(`!!document.querySelector('.mdl .handoff-choices')`, 3000);
  const choices = await ctx.run(`[...document.querySelectorAll('.handoff-choice .handoff-title')].map((e) => e.textContent)`);
  check('...Antippen fragt "Von welchem Geraet fortsetzen?" mit beiden Geraeten', chooser && JSON.stringify(choices) === JSON.stringify(['Wohnzimmer Apple TV', 'iPad Air']) && (await ctx.run(`document.querySelector('.mdl-title')?.textContent`)) === 'Von welchem Gerät fortsetzen?', JSON.stringify(choices));
  await ctx.wait(300);
  await ctx.capture(path.join(out, 'HO-02-auswahl.png'));
  state.log.length = 0;
  await ctx.run(`[...document.querySelectorAll('.handoff-choice')][1].click()`);
  await until(() => ctx.player.active, 10000);
  check('...das gewaehlte Geraet haelt an, das andere laeuft weiter', logAt('RemoteStop').length === 1 && logAt('RemoteStop')[0].ItemId === movieA.Id && state.remote.some((x) => x.device === 'Wohnzimmer Apple TV'), JSON.stringify(logAt('RemoteStop')));
  await ctx.player.stop();
  await until(() => !ctx.player.active, 5000);
  await ctx.wait(800);

  // Nimmt den Stopp gerade nicht an (Steuerkanal baut sich neu auf): nichts starten, Meldung
  await debug('session?clear=1');
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieB.Id}&at=200`);
  await until(async () => !!(await capsule()), 8000);
  await debug('session?clear=1');
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieB.Id}&at=200&control=0`); // dieselbe Sitzung, gerade nicht steuerbar
  state.log.length = 0;
  await ctx.run(`document.querySelector('.handoff-btn')?.click()`);
  const refused = await waitFor(`/nimmt den Stopp gerade nicht an/.test(document.querySelector('.mdl')?.textContent ?? '')`, 6000);
  check('Nimmt den Stopp gerade nicht an: Meldung "Fortsetzen nicht moeglich", nichts angehalten, nichts gestartet', refused && (await ctx.run(`document.querySelector('.mdl-title')?.textContent`)) === 'Fortsetzen nicht möglich' && logAt('RemoteStop').length === 0 && !ctx.player.active && logAt('PlaybackInfo').length === 0);
  await ctx.wait(300);
  await ctx.capture(path.join(out, 'HO-03-meldung.png'));
  await ctx.run(`[...document.querySelectorAll('.mdl-actions .btn')].find((b) => b.textContent === 'OK')?.click()`);
  await waitFor(`!document.querySelector('.mdl')`, 3000);

  // Inzwischen laeuft dort ein anderer Titel
  await debug('session?clear=1');
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieB.Id}&at=200`);
  await until(async () => (await capsule())?.detail?.startsWith(movieB.Name), 8000);
  await debug('session?clear=1');
  await debug(`session?device=${encodeURIComponent('Wohnzimmer Apple TV')}&item=${movieA.Id}&at=30`);
  state.log.length = 0;
  await ctx.run(`document.querySelector('.handoff-btn')?.click()`);
  const other = await waitFor(`/läuft inzwischen etwas anderes/.test(document.querySelector('.mdl')?.textContent ?? '')`, 6000);
  check('Laeuft dort inzwischen etwas anderes: Meldung, nichts angehalten, nichts gestartet', other && logAt('RemoteStop').length === 0 && logAt('PlaybackInfo').length === 0);
  await ctx.run(`[...document.querySelectorAll('.mdl-actions .btn')].find((b) => b.textContent === 'OK')?.click()`);
  await waitFor(`!document.querySelector('.mdl')`, 3000);

  // Eine andere Seite vorne: kein Abfragen, kein Angebot
  await go('#/movies', `!!document.querySelector('.library')`);
  await ctx.wait(400);
  const away0 = polls();
  await ctx.wait(6000);
  check('Andere Seite vorne: keine Abfrage und keine Kapsel', polls() === away0 && (await capsule()) === null, `${polls() - away0} Abfragen`);

  // Einstellung aus: keine Abfrage
  await go('#/settings/behavior', `!!document.querySelector('.settings-panel')`);
  const handoffToggle = `[...document.querySelectorAll('.settings-panel .setting')].find((s) => /Auf diesem Gerät fortsetzen/.test(s.querySelector('.setting-label')?.textContent ?? ''))?.querySelector('[role=switch]')`;
  const toggleInfo = await ctx.run(`(() => { const t = ${handoffToggle}; const block = t?.closest('.settings-block'); return t ? { on: t.getAttribute('aria-checked'), head: block?.querySelector('.group-title')?.textContent, foot: block?.querySelector('.group-foot')?.textContent } : null; })()`);
  check('Einstellungen > Wiedergabe > Andere Geraete: Schalter, Standard an, mit Erklaerung', toggleInfo?.on === 'true' && toggleInfo.head === 'Andere Geräte' && /hält die Wiedergabe dann an/.test(toggleInfo.foot ?? ''), JSON.stringify(toggleInfo));
  await ctx.capture(path.join(out, 'HO-04-einstellung.png'));
  await ctx.run(`${handoffToggle}.click()`);
  await ctx.wait(1200);
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  const off0 = polls();
  await ctx.wait(6000);
  check('Ausgeschaltet: keine Abfrage, keine Kapsel', polls() === off0 && (await capsule()) === null, `${polls() - off0} Abfragen`);
  await go('#/settings/behavior', `!!document.querySelector('.settings-panel')`);
  await ctx.run(`${handoffToggle}.click()`);
  await ctx.wait(1200);
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  check('Wieder an: die Kapsel ist zurueck', await until(async () => !!(await capsule()), 8000));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  await debug('socket?drop=1');
  server.closeAllConnections?.();
  server.close();
  if (fail) process.exitCode = 1;
};
