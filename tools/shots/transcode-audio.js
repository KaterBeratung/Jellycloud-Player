// Transcoding und Ton-Ausgabe im Player (JC_DEV=1, JC_FAKE_MPV=1): Spurwechsel im Transcode, Rueckfall auf Transcode,
// Stereo-Profil, Bitstream-Schutz, Ton-Rueckfall, Kanalumschaltung, Statistik nur bei offener Info.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/transcode-audio.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const cmd = (c) => ev(`window.player.send(${JSON.stringify(c)})`);
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(50);
    }
    return false;
  };
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const log = path.join(os.tmpdir(), `jc-fake-${process.pid}.log`);
  const fakeLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const fresh = () => {
    fs.rmSync(log, { force: true });
    player.fake.env.FAKE_LOG = log;
  };
  const infos = () => state.log.filter((l) => l.at === 'PlaybackInfo');
  const start = async (req = {}) => {
    fresh();
    state.log.length = 0;
    await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, ${Object.entries(req).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} })`);
    return waitFor(() => player.state.phase === 'playing');
  };
  const stop = async () => {
    await cmd({ type: 'close' });
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(300);
  };
  const dev = (over = {}) => ({ id: '{0.0.0.00000000}.{AAAA}', name: 'Test-Geraet', form: 1, channels: 2, mask: 3, physical: 0, default: true, ...over });
  const probeWith = (list) => ({ get: () => list, ensureFresh: () => list, refresh: async () => list });
  const settings = (patch) => ctx.config.updateSettings({ player: patch });

  // ---------- A. Transcode (Bitratenlimit): Spuren kommen vom Server, Wechsel laedt neu ----------
  await settings({ maxBitrateMbps: 8 });
  check('Transcode gestartet', await start(), `phase=${player.state.phase}`);
  check('Methode Transcode, HLS-URL', player.state.method === 'Transcode' && /master\.m3u8/.test(player.cur?.res.url ?? ''), player.state.method);
  const i0 = infos()[0];
  check('PlaybackInfo nennt die gewaehlte Tonspur (nur diese steckt im Transcode-Strom)', i0?.audioIndex === 1, `audioIndex=${i0?.audioIndex}`);
  const tr0 = player.state.tracks;
  check('Spurliste im Transcode kommt vom Server (alle Ton- und Untertitelspuren)', tr0?.audio?.length === 2 && tr0?.sub?.length >= 3, `${tr0?.audio?.length} Ton / ${tr0?.sub?.length} Untertitel`);
  check('Aktuelle Tonspur ist markiert', tr0.audio.find((a) => a.selected)?.id === 1);
  await ctx.wait(1200);

  // Tonspur wechseln -> neuer Transcode an der aktuellen Position
  const posBefore = player.state.position;
  state.log.length = 0;
  await cmd({ type: 'audio', id: 2 });
  check('Tonwechsel laedt neu (neue PlaybackInfo mit der Tonspur)', await waitFor(() => infos().some((l) => l.audioIndex === 2)), JSON.stringify(infos().map((l) => l.audioIndex)));
  check('...und startet wieder', await waitFor(() => player.state.phase === 'playing' && player.cur?.audioIdx === 2), `phase=${player.state.phase} idx=${player.cur?.audioIdx}`);
  const nInfo = infos().find((l) => l.audioIndex === 2);
  check('...an der aktuellen Position (nicht von vorn)', Math.abs(nInfo.startTicks / 1e7 - posBefore) < 4, `${(nInfo.startTicks / 1e7).toFixed(1)} s ~ ${posBefore.toFixed(1)} s`);
  check('Der alte Transcode wird gemeldet und beendet', await waitFor(() => state.log.some((l) => l.at === '/Sessions/Playing/Stopped')), state.log.map((l) => l.at).join(' > '));
  check('Spurliste zeigt die neue Tonspur', player.state.tracks.audio.find((a) => a.selected)?.id === 2);

  // Textuntertitel im Transcode: kommt als Datei vom Server (sub-add)
  state.log.length = 0;
  await cmd({ type: 'sub', id: 3 });
  check('Untertitelwechsel laedt neu mit der Untertitelspur', await waitFor(() => infos().some((l) => l.subtitleIndex === 3)), JSON.stringify(infos().map((l) => l.subtitleIndex)));
  await waitFor(() => player.state.phase === 'playing' && player.cur?.subIdx === 3);
  check('Untertitel wird als externe Datei angehaengt und gewaehlt', await waitFor(() => (player.mpv.prop('track-list') ?? []).some((t) => t.type === 'sub' && t.external && t.selected)), JSON.stringify(player.mpv.prop('track-list')?.filter((t) => t.external)));
  check('Tonspur bleibt beim Untertitelwechsel erhalten', player.cur?.audioIdx === 2 && infos().at(-1)?.audioIndex === 2, `audio=${player.cur?.audioIdx}`);
  await cmd({ type: 'sub', id: null });
  check('Untertitel aus: neue Anfrage mit -1', await waitFor(() => infos().some((l) => l.subtitleIndex === -1)), JSON.stringify(infos().map((l) => l.subtitleIndex)));
  await waitFor(() => player.state.phase === 'playing');

  // Schnelle Spruenge werden zu einem zusammengefasst (jeder Sprung startet beim Server eine neue Codierung)
  fresh();
  for (let i = 0; i < 4; i++) await cmd({ type: 'seek', by: 10 });
  await ctx.wait(900);
  const seeks = fakeLog().filter((l) => l.cmd === 'seek');
  check('Mehrere schnelle Spruenge im Transcode = ein Seek', seeks.length === 1 && seeks[0].args[0] === 40, JSON.stringify(seeks.map((s) => s.args)));
  await stop();

  // ---------- B. Direct Play: Spruenge gehen einzeln durch ----------
  await settings({ maxBitrateMbps: 0 });
  check('Direct Play gestartet', await start());
  fresh();
  await cmd({ type: 'seek', by: 10 });
  await cmd({ type: 'seek', by: 10 });
  await ctx.wait(500);
  check('Direct Play: Spruenge sofort und einzeln', fakeLog().filter((l) => l.cmd === 'seek').length === 2);

  // Statistik nur bei offener Info
  const observed = () => fakeLog().filter((l) => l.cmd === 'observe_property').map((l) => l.args[1]);
  check('Ohne Technik-Info keine Statistik-Eigenschaften beobachtet', !observed().includes('estimated-vf-fps') && !observed().includes('demuxer-cache-time'));
  await cmd({ type: 'stats', on: true });
  await ctx.wait(300);
  check('Technik-Info offen: Statistik wird beobachtet', fakeLog().filter((l) => l.cmd === 'observe_property').map((l) => l.args[1]).includes('estimated-vf-fps'));
  await cmd({ type: 'stats', on: false });
  await ctx.wait(300);
  check('Technik-Info zu: Statistik wird abgemeldet', fakeLog().some((l) => l.cmd === 'unobserve_property'));

  // Kanalumschaltung waehrend der Wiedergabe
  await cmd({ type: 'channels', value: '5.1' });
  await waitFor(() => player.state.audioOut?.channels === 6);
  check('Kanalumschaltung auf 5.1 erreicht mpv und die Anzeige', player.state.audioOut?.channels === 6 && player.state.audioCfg?.mode === '5.1', JSON.stringify(player.state.audioOut));
  await cmd({ type: 'channels', value: 'stereo' });
  await waitFor(() => player.state.audioOut?.channels === 2);
  check('Umschalten auf Stereo wirkt sofort', player.state.audioOut?.channels === 2 && player.state.audioCfg?.mode === 'stereo' && player.audio.outChannels === 2);
  await cmd({ type: 'channels', value: 'bogus' });
  await ctx.wait(200);
  check('Ungueltiger Kanalmodus wird ignoriert', player.state.audioCfg?.mode === 'stereo');

  // Qualitaet im Player: Popup, Wahl erzeugt einen Transcode an der aktuellen Position, "Original" geht zurueck
  const qBtn = `document.querySelector('.cluster .ibtn[title="Qualität"]')`;
  check('Qualitaets-Knopf ist sichtbar (Transcoding erlaubt)', await ev(`!!${qBtn} && !${qBtn}.hidden`));
  await ev(`${qBtn}.click()`);
  await ctx.wait(450);
  const qRows = await ev(`[...document.querySelectorAll('.pop .opt')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
  check('Popup: Original (mit Quellbitrate) und Stufen unterhalb der Quelle', qRows[0]?.startsWith('Original') && /52 Mbit/.test(qRows[0]) && qRows.some((r) => r.startsWith('8 Mbit/s')) && qRows.some((r) => r.startsWith('20 Mbit/s')), JSON.stringify(qRows));
  check('Original ist markiert', (await ev(`document.querySelector('.pop .opt.sel')?.innerText ?? ''`)).startsWith('Original'));
  const posQ = player.state.position;
  state.log.length = 0;
  await ev(`[...document.querySelectorAll('.pop .opt')].find((b) => /^8 Mbit/.test(b.innerText.trim())).click()`);
  check('Wahl "8 Mbit/s": neue PlaybackInfo mit Bitratengrenze', await waitFor(() => infos().some((l) => l.maxBitrate === 8_000_000)), JSON.stringify(infos().map((l) => l.maxBitrate)));
  check('...der Server transcodiert, der Player laeuft weiter', await waitFor(() => player.state.phase === 'playing' && player.state.method === 'Transcode'), `phase=${player.state.phase} method=${player.state.method}`);
  check('...an der aktuellen Position', Math.abs(infos().find((l) => l.maxBitrate === 8_000_000).startTicks / 1e7 - posQ) < 6, `${(infos()[0].startTicks / 1e7).toFixed(1)} s ~ ${posQ.toFixed(1)} s`);
  check('Anzeige kennt die Grenze, Symbol ist hervorgehoben', player.state.quality?.mbps === 8 && (await ev(`${qBtn}.classList.contains('lim')`)));
  check('Tonspur bleibt bei der Qualitaetswahl erhalten', infos().at(-1)?.audioIndex === player.cur?.audioIdx);
  state.log.length = 0;
  await cmd({ type: 'quality', mbps: 0 });
  check('Zurueck auf Original: Direct Play ohne Bitratengrenze', await waitFor(() => player.state.phase === 'playing' && player.state.method === 'DirectPlay') && infos().at(-1)?.maxBitrate === undefined, `method=${player.state.method} max=${infos().at(-1)?.maxBitrate}`);
  state.log.length = 0;
  await cmd({ type: 'quality', mbps: -5 });
  await cmd({ type: 'quality', mbps: 'x' });
  await cmd({ type: 'quality', mbps: 0 });
  await ctx.wait(500);
  check('Ungueltige oder unveraenderte Qualitaet loest nichts aus', infos().length === 0, `${infos().length} Anfragen`);
  await cmd({ type: 'quality', mbps: 4 });
  await waitFor(() => player.state.method === 'Transcode' && player.state.phase === 'playing');
  await stop();
  check('Die Wahl gilt nur fuer diese Wiedergabe', player.quality === undefined);

  // ---------- C. Stereo-Ausgabe: Transcode-Profil, Argumente, Bitstream-Schutz ----------
  const realProbe = player.audioProbe;
  player.audioProbe = probeWith([dev({ form: 3, channels: 2, name: 'Kopfhoerer' })]);
  await settings({ audioPassthrough: true, audioExclusive: true, maxBitrateMbps: 8 });
  check('Stereo-Geraet + Passthrough-Wunsch: Wiedergabe startet', await start());
  const argv = fakeLog()[0]?.args ?? [];
  check('mpv bekommt Stereo', argv.includes('--audio-channels=stereo'), argv.filter((a) => a.startsWith('--audio')).join(' '));
  check('Kein Bitstream an Kopfhoerern (sonst Stille)', !argv.some((a) => a.startsWith('--audio-spdif') || a === '--audio-exclusive=yes' || a === '--ao=wasapi'), argv.filter((a) => /spdif|exclusive|--ao/.test(a)).join(' '));
  check('Transcode-Profil verlangt hoechstens 2 Kanaele (Server mischt herunter)', infos()[0]?.maxAudioChannels === '2', `MaxAudioChannels=${infos()[0]?.maxAudioChannels}`);
  check('Anzeige kennt das Geraet', player.state.audioCfg?.device === 'Kopfhoerer' && player.state.audioCfg?.passthroughBlocked === true, JSON.stringify(player.state.audioCfg));
  check('IPC-Auskunft fuer die Oberflaeche', player.audioOutput().outChannels === 2 && player.audioOutput().passthroughBlocked === true);
  await stop();

  // HDMI-Receiver mit 8 Kanaelen: Bitstream erlaubt, Surround bleibt
  player.audioProbe = probeWith([dev({ form: 9, channels: 8, name: 'AV-Receiver' })]);
  await settings({ maxBitrateMbps: 8 });
  check('HDMI-Receiver + Passthrough: Wiedergabe startet', await start());
  const argv2 = fakeLog()[0]?.args ?? [];
  check('Bitstream bleibt an HDMI', argv2.includes('--ao=wasapi') && argv2.some((a) => a.startsWith('--audio-spdif')) && argv2.includes('--audio-exclusive=yes'));
  check('Transcode-Profil bleibt bei 8 Kanaelen', infos()[0]?.maxAudioChannels === '8', `MaxAudioChannels=${infos()[0]?.maxAudioChannels}`);
  await stop();
  player.audioProbe = realProbe;
  await settings({ audioPassthrough: false, audioExclusive: false, maxBitrateMbps: 0 });

  // ---------- D. Ton-Rueckfall: Ausgabe laesst sich nicht oeffnen -> automatisch PCM-Stereo ----------
  player.fake.env.FAKE_NO_AO = '1';
  check('Start bei defekter Tonausgabe', await start());
  check('Anfangs keine Tonausgabe', !player.state.audioOut?.active);
  const healed = await waitFor(() => player.state.notice?.kind === 'audioFallback' && player.state.audioOut?.active, 12000);
  check('Nach wenigen Sekunden schaltet der Player selbst auf PCM-Stereo um', healed, JSON.stringify({ notice: player.state.notice, out: player.state.audioOut }));
  const cmds = fakeLog().filter((l) => l.cmd);
  check('Rueckfall-Befehle: kein Bitstream, nicht exklusiv, Stereo, Ausgabe neu oeffnen', ['audio-spdif', 'audio-exclusive', 'audio-channels'].every((p) => cmds.some((c) => c.cmd === 'set_property' && c.args[0] === p)) && cmds.some((c) => c.cmd === 'ao-reload'));
  check('Anzeige zeigt Stereo', player.state.audioCfg?.mode === 'stereo' && player.state.audioOut?.channels === 2);
  await stop();
  delete player.fake.env.FAKE_NO_AO;

  // Mit Ton, aber pausiert/ladend: kein falscher Alarm
  check('Start mit funktionierender Ausgabe', await start());
  await ctx.wait(4500);
  check('Funktionierender Ton loest keinen Rueckfall aus', player.state.notice?.kind !== 'audioFallback' && player.state.audioCfg?.mode === 'auto', JSON.stringify(player.state.audioCfg));
  await stop();

  // ---------- E. Rueckfall auf Transcode, wenn Direct Play nicht abspielbar ist ----------
  player.fake.env.FAKE_FAIL_DIRECT = '1';
  fresh();
  state.log.length = 0;
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: ${600 * 1e7} })`);
  check('Direct Play scheitert -> Player weicht automatisch auf Transcode aus', await waitFor(() => player.state.phase === 'playing' && player.state.method === 'Transcode', 10000), `phase=${player.state.phase} method=${player.state.method}`);
  check('Zweite Anfrage schliesst Direct Play aus', infos().length === 2 && infos()[0].enableDirectPlay !== false && infos()[1].enableDirectPlay === false, JSON.stringify(infos().map((l) => l.enableDirectPlay)));
  check('Hinweis fuer den Nutzer', player.state.notice?.kind === 'transcodeFallback');
  check('Der Transcode setzt dort fort, wo Direct Play scheiterte (595 s = 600 s minus Ruecksprung)', Math.abs(infos()[1].startTicks / 1e7 - 595) < 3, `${(infos()[1].startTicks / 1e7).toFixed(1)} s`);
  await stop();

  // Transcode verboten: Fehler statt Ausweichen
  await settings({ allowTranscode: false });
  fresh();
  state.log.length = 0;
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  check('Transcode verboten: Fehleranzeige statt Ausweichen', await waitFor(() => player.state.phase === 'error', 8000), `phase=${player.state.phase}`);
  check('Transcode verboten: keine Qualitaetswahl im Player', player.state.quality?.allowed === false && (await ev(`document.querySelector('.cluster .ibtn[title="Qualität"]').hidden`)));
  check('...und keine zweite PlaybackInfo', infos().length === 1, `${infos().length} Anfragen`);
  await stop();
  await settings({ allowTranscode: true });
  delete player.fake.env.FAKE_FAIL_DIRECT;

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  fs.rmSync(log, { force: true });
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
