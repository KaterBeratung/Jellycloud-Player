// Zurueck-Taste im Player: reagiert sofort, auch bei langsamem Server und waehrend des Ladens (JC_DEV=1, JC_FAKE_MPV=1).
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/back-latency.js
const { server, items, state } = require('../mock-server');

module.exports = async (ctx) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const player = ctx.player;
  // Schliesst die Aktion den Player, ist das Overlay schon weg, bevor executeJavaScript antwortet: das ist Absicht und kein Fehler
  const ev = (js) => player.overlay.webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(50);
    }
    return false;
  };
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const errors = [];
  process.on('unhandledRejection', (e) => errors.push(String(e?.message ?? e)));

  // ---------- 1. Langsamer Server: Schliessen darf nicht auf die Stopped-Meldung warten ----------
  state.log.length = 0;
  state.delays.stopped = 4000;
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  check('Wiedergabe gestartet', await waitFor(() => player.state.phase === 'playing'), `phase=${player.state.phase}`);
  await ctx.wait(800);
  const closedAt = new Promise((resolve) => player.once('closed', () => resolve(Date.now())));
  const ovl = player.overlay;
  const proc = player.mpv.proc;
  const t0 = Date.now();
  await ev(`document.querySelector('.top .round').click()`);
  // Sichtbar beendet = Overlay-Fenster zerstoert und mpv-Prozess beendet (die Oberflaeche ist wieder bedienbar)
  let gone = null;
  while (Date.now() - t0 < 9000) {
    if (ovl.isDestroyed() && proc.exitCode !== null && !player.overlay && !player.mpv) {
      gone = Date.now();
      break;
    }
    await ctx.wait(5);
  }
  const dt = gone ? gone - t0 : Infinity;
  check('Zurueck-Taste beendet den Player zuegig, obwohl der Server 4 s bis zur Stopped-Antwort braucht', dt < 1000, `${dt} ms`);
  const closed = await Promise.race([closedAt, ctx.wait(9000).then(() => null)]);
  check('"closed" folgt hoechstens 2,5 s nach dem Klick (wartet kurz auf die Stopped-Meldung, damit Listen frisch sind)', !!closed && closed - t0 < 2500, `${closed ? closed - t0 : '-'} ms`);
  // Die Stopped-Meldung muss trotzdem beim Server ankommen (Position wird gespeichert)
  const gotStopped = await waitFor(() => state.log.some((l) => l.at === '/Sessions/Playing/Stopped' && l.ItemId === movie.Id), 6000);
  check('Stopped wird im Hintergrund trotzdem gemeldet', gotStopped);
  const stopped = state.log.find((l) => l.at === '/Sessions/Playing/Stopped');
  check('Stopped meldet die Position', stopped?.PositionTicks > 0, `${(stopped?.PositionTicks / 1e7).toFixed(1)} s`);
  state.delays.stopped = 0;

  // ---------- 2. Schliessen waehrend des Ladens (PlaybackInfo braucht 1,5 s) ----------
  state.delays.playbackInfo = 1500;
  const playP = ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false }).then(() => 'ok', (e) => 'ERR:' + e.message)`);
  await waitFor(() => !!player.overlay, 3000);
  await ctx.wait(300);
  player.overlay.webContents.send('player:state', {}); // Overlay lebt
  const t1 = Date.now();
  const closedLoading = new Promise((resolve) => player.once('closed', () => resolve(Date.now())));
  await ev(`window.player.send({ type: 'close' })`);
  const c2 = await Promise.race([closedLoading, ctx.wait(9000).then(() => null)]);
  check('Schliessen waehrend des Ladens reagiert sofort', !!c2 && c2 - t1 < 1000, `${c2 ? c2 - t1 : '-'} ms`);
  const playResult = await Promise.race([playP, ctx.wait(9000).then(() => 'timeout')]);
  check('Abgebrochener Start meldet keinen Fehler an die Oberflaeche', !String(playResult).startsWith('ERR') && playResult !== 'timeout', String(playResult));
  await ctx.wait(1800); // die verspaetete PlaybackInfo-Antwort trifft ein
  check('Nach dem Abbruch bleibt nichts zurueck (kein mpv, kein Fenster, kein Zustand)', !player.mpv && !player.host && !player.overlay && !player.cur && !player.busy && !player.stopping);
  state.delays.playbackInfo = 0;

  // ---------- 3. Danach laesst sich normal weiter abspielen ----------
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  check('Erneutes Abspielen funktioniert', await waitFor(() => player.state.phase === 'playing'), `phase=${player.state.phase}`);
  const t3 = Date.now();
  const closed3 = new Promise((resolve) => player.once('closed', () => resolve(Date.now())));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const c3 = await Promise.race([closed3, ctx.wait(9000).then(() => null)]);
  check('Escape schliesst den Player', !!c3 && c3 - t3 < 1000, `${c3 ? c3 - t3 : '-'} ms`);

  // ---------- 4. Weitere Wege zurueck: Backspace und Maus-Zurueck-Taste; doppelter Klick sendet nur einmal ----------
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  await waitFor(() => player.state.phase === 'playing');
  const t4 = Date.now();
  const closed4 = new Promise((resolve) => player.once('closed', () => resolve(Date.now())));
  await ev(`window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))`);
  const c4 = await Promise.race([closed4, ctx.wait(9000).then(() => null)]);
  check('Maus-Zurueck-Taste schliesst den Player', !!c4 && c4 - t4 < 1000, `${c4 ? c4 - t4 : '-'} ms`);
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  await waitFor(() => player.state.phase === 'playing');
  let closeCmds = 0;
  const origStop = player.stop.bind(player);
  player.stop = (...a) => (closeCmds++, origStop(...a));
  await ev(`(() => { const b = document.querySelector('.top .round'); b.click(); b.click(); b.click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); })()`);
  await waitFor(() => !player.overlay && !player.mpv, 4000);
  player.stop = origStop;
  check('Mehrfachklick auf Zurueck schliesst genau einmal', closeCmds === 1, `stop() ${closeCmds}x aufgerufen`);
  await ctx.wait(1800);

  check('Keine unbehandelten Fehler', errors.length === 0, errors.join('; '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
