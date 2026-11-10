'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FORM, parseProbeOutput, probeAudioEndpoints, AudioOutputProbe, endpointIdFromSetting, pickDevice, resolveAudioOutput, SCRIPT } = require('../src/main/audio-output');
const { DEFAULT_SETTINGS } = require('../src/main/config');
const { buildMpvArgs } = require('../src/main/mpv-args');
const { pickStreams } = require('../src/shared/media');

const dev = (over = {}) => ({ id: '{0.0.0.00000000}.{AAAA}', name: 'Geraet', form: FORM.SPEAKERS, channels: 2, mask: 3, physical: 0, default: true, ...over });
const player = (over = {}) => ({ ...DEFAULT_SETTINGS.player, ...over });
const decide = (over, endpoints) => resolveAudioOutput({ player: player(over), endpoints });

test('Ausgabe: ohne Geraeteerkennung bleibt alles wie bisher (auto-safe)', () => {
  const d = decide({}, null);
  assert.equal(d.channels, 'auto-safe');
  assert.equal(d.outChannels, null);
  assert.equal(d.passthrough, false);
});

test('Ausgabe: Stereo-Geraet und Kopfhoerer bekommen Stereo, auch wenn Windows mehr Kanaele meldet', () => {
  assert.deepEqual([decide({}, [dev({ channels: 2 })]).channels, decide({}, [dev({ channels: 2 })]).outChannels], ['stereo', 2]);
  const hp = decide({}, [dev({ form: FORM.HEADPHONES, channels: 8 })]);
  assert.equal(hp.channels, 'stereo');
  assert.ok(hp.reasons.includes('stereo-device'));
  assert.equal(decide({}, [dev({ form: FORM.HEADSET, channels: 6 })]).channels, 'stereo');
});

test('Ausgabe: Surround-Ausgang (HDMI/Lautsprecher mit 6-8 Kanaelen) behaelt die Kanalzahl des Geraets', () => {
  const avr = decide({}, [dev({ form: FORM.HDMI, channels: 8 })]);
  assert.equal(avr.channels, 'auto-safe');
  assert.equal(avr.outChannels, 8);
  assert.equal(decide({}, [dev({ channels: 6 })]).outChannels, 6);
});

test('Ausgabe: manuelle Kanalwahl gilt immer', () => {
  assert.equal(decide({ audioChannels: '5.1' }, [dev({ channels: 2 })]).channels, '5.1');
  assert.equal(decide({ audioChannels: 'stereo' }, [dev({ form: FORM.HDMI, channels: 8 })]).outChannels, 2);
});

test('Ausgabe: Bitstream nur an digitalen Ausgaengen, sonst wuerde nichts zu hoeren sein', () => {
  const blocked = decide({ audioPassthrough: true, audioExclusive: true }, [dev({ form: FORM.HEADPHONES, channels: 2 })]);
  assert.equal(blocked.passthrough, false);
  assert.equal(blocked.exclusive, false);
  assert.ok(blocked.reasons.includes('passthrough-needs-digital'));
  assert.equal(blocked.channels, 'stereo');
  for (const form of [FORM.HDMI, FORM.SPDIF, FORM.DIGITAL]) {
    const ok = decide({ audioPassthrough: true, audioExclusive: true }, [dev({ form, channels: 2 })]);
    assert.equal(ok.passthrough, true, `Form ${form}`);
    assert.equal(ok.exclusive, true);
    assert.equal(ok.outChannels, null, 'Bei Bitstream dekodiert der Receiver');
    assert.equal(ok.channels, 'auto-safe', 'bei Bitstream kein Stereo erzwingen (PCM-Rueckfall nutzt das Geraet)');
  }
  // Geraet unbekannt: Wunsch des Nutzers bleibt
  assert.equal(decide({ audioPassthrough: true }, null).passthrough, true);
});

test('Geraeteauswahl: Standardgeraet oder das in den Einstellungen gewaehlte (mpv-Name wasapi/<Endpunkt-ID>)', () => {
  const list = [dev({ id: '{0.0.0.00000000}.{A}', default: true, channels: 2 }), dev({ id: '{0.0.0.00000000}.{B}', default: false, channels: 8, form: FORM.HDMI })];
  assert.equal(endpointIdFromSetting('wasapi/{0.0.0.00000000}.{B}'), '{0.0.0.00000000}.{B}');
  assert.equal(endpointIdFromSetting('auto'), null);
  assert.equal(pickDevice(list, 'auto').id, '{0.0.0.00000000}.{A}');
  assert.equal(pickDevice(list, 'wasapi/{0.0.0.00000000}.{b}').channels, 8, 'Gross-/Kleinschreibung egal');
  assert.equal(pickDevice(list, 'wasapi/{0.0.0.00000000}.{ZZ}'), null, 'unbekanntes Geraet -> keine Annahme');
  assert.equal(pickDevice([], 'auto'), null);
  assert.equal(decide({ audioDevice: 'wasapi/{0.0.0.00000000}.{B}' }, list).outChannels, 8);
});

test('mpv-Argumente folgen der Entscheidung (und ohne Entscheidung den Einstellungen)', () => {
  const base = { pipe: 'p', wid: '1', version: [0, 41, 0] };
  const stereo = buildMpvArgs({ ...base, player: player(), audio: { channels: 'stereo', passthrough: false, exclusive: false } });
  assert.ok(stereo.includes('--audio-channels=stereo') && !stereo.some((x) => x.startsWith('--audio-spdif')));
  const pass = buildMpvArgs({ ...base, player: player(), audio: { channels: 'auto-safe', passthrough: true, exclusive: true } });
  assert.ok(pass.includes('--ao=wasapi') && pass.includes('--audio-exclusive=yes') && pass.includes('--audio-channels=auto-safe'));
  const blocked = buildMpvArgs({ ...base, player: player({ audioPassthrough: true }), audio: { channels: 'stereo', passthrough: false, exclusive: false } });
  assert.ok(!blocked.some((x) => x.startsWith('--audio-spdif')), 'Entscheidung hat Vorrang vor der Einstellung');
  const legacy = buildMpvArgs({ ...base, player: player({ audioPassthrough: true }) });
  assert.ok(legacy.some((x) => x.startsWith('--audio-spdif')));
  assert.ok(stereo.some((x) => x.startsWith('--stream-lavf-o=reconnect=1')), 'kurze Netzabbrueche werden ueberbrueckt');
});

test('Spurauswahl: bei Stereo-Ausgabe die Stereo-Spur derselben Sprache statt Surround', () => {
  const source = {
    DefaultAudioStreamIndex: 1,
    MediaStreams: [
      { Index: 1, Type: 'Audio', Language: 'ger', Channels: 6, IsDefault: true, DisplayTitle: 'Deutsch 5.1' },
      { Index: 2, Type: 'Audio', Language: 'ger', Channels: 2, DisplayTitle: 'Deutsch Stereo' },
      { Index: 3, Type: 'Audio', Language: 'eng', Channels: 2, DisplayTitle: 'English Stereo' },
      { Index: 4, Type: 'Audio', Language: 'ger', Channels: 2, Title: 'Kommentar', DisplayTitle: 'Deutsch Kommentar' }
    ]
  };
  assert.equal(pickStreams(source, {}, 'de').audioIndex, 1, 'ohne Ausgabeangabe bleibt die Server-Vorgabe');
  assert.equal(pickStreams(source, {}, 'de', 6).audioIndex, 1, 'Surround-Ausgabe behaelt Surround');
  assert.equal(pickStreams(source, {}, 'de', 2).audioIndex, 2, 'Stereo-Ausgabe nimmt Stereo derselben Sprache (nicht den Kommentar)');
  assert.equal(pickStreams(source, { audioLanguage: 'de' }, 'de', 2).audioIndex, 2);
  // Gibt es keine Stereo-Spur in dieser Sprache, bleibt die Surround-Spur (wird heruntergemischt)
  const noStereo = { DefaultAudioStreamIndex: 1, MediaStreams: [source.MediaStreams[0], source.MediaStreams[2]] };
  assert.equal(pickStreams(noStereo, {}, 'de', 2).audioIndex, 1);
});

test('Hilfsskript-Ausgabe wird gelesen; kaputte Ausgabe ergibt null', () => {
  const list = parseProbeOutput('Warnung\r\n[{"id":"{x}","name":"Lautsprecher","form":9,"channels":8,"mask":1599,"physical":0,"default":true}]\r\n');
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].form, list[0].channels, list[0].default], [9, 8, true]);
  assert.equal(parseProbeOutput('kein json'), null);
  assert.equal(parseProbeOutput(''), null);
  assert.equal(parseProbeOutput('{"a":1}'), null);
});

test('Geraeteabfrage: nur unter Windows, Fehler/Zeitueberschreitung ergeben null (dann gilt "Auto" wie bisher)', async () => {
  assert.equal(await probeAudioEndpoints({ platform: 'linux' }), null);
  const failing = (_f, _a, _o, cb) => cb(new Error('boom'));
  assert.equal(await probeAudioEndpoints({ execFileImpl: failing, platform: 'win32' }), null);
  const ok = (file, args, _o, cb) => {
    assert.equal(file, 'powershell.exe');
    assert.ok(args.includes('-EncodedCommand') && args.includes('-NoProfile'));
    cb(null, '[{"id":"{a}","name":"X","form":1,"channels":2,"mask":3,"physical":0,"default":true}]');
  };
  assert.equal((await probeAudioEndpoints({ execFileImpl: ok, platform: 'win32' }))[0].channels, 2);
  assert.ok(/IMMDevice|AudProbe/.test(SCRIPT));
});

test('AudioOutputProbe: Zwischenspeicher, keine parallelen Abfragen, Ergebnis bleibt bei Fehlschlag erhalten', async () => {
  let calls = 0;
  let result = [dev()];
  let t = 0;
  const probe = new AudioOutputProbe({ probe: async () => (calls++, await new Promise((r) => setTimeout(r, 10)), result), ttlMs: 1000, now: () => t });
  assert.equal(probe.get(), null);
  await Promise.all([probe.refresh(), probe.refresh()]);
  assert.equal(calls, 1, 'gleichzeitige Aufrufe teilen sich eine Abfrage');
  assert.equal(probe.get().length, 1);
  probe.ensureFresh();
  assert.equal(calls, 1, 'frisch genug: keine neue Abfrage');
  t = 5000;
  result = null; // Abfrage scheitert
  probe.ensureFresh();
  await probe.refresh();
  assert.equal(calls, 2, 'veraltet -> neue Abfrage (einmal)');
  assert.equal(probe.get().length, 1, 'letzter guter Stand bleibt');
});
