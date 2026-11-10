'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMpvArgs, parseMpvVersion, versionAtLeast, findMpv } = require('../src/main/mpv-args');
const { DEFAULT_SETTINGS } = require('../src/main/config');

const player = (over = {}) => ({ ...DEFAULT_SETTINGS.player, ...over });
const args = (over, extra = {}) => buildMpvArgs({ player: player(over), pipe: '\\\\.\\pipe\\x', wid: '12345', version: [0, 41, 0], ...extra });

test('Version wird aus mpv --version gelesen', () => {
  assert.deepEqual(parseMpvVersion('mpv 0.39.0-dirty Copyright'), [0, 39, 0]);
  assert.deepEqual(parseMpvVersion('mpv v0.40.0'), [0, 40, 0]);
  assert.equal(parseMpvVersion('kaputt'), null);
  assert.ok(versionAtLeast([0, 40, 0], 0, 39));
  assert.ok(!versionAtLeast([0, 37, 1], 0, 39));
});

test('Eingebettet: wid, keine eigene Bedienung, gpu-next mit d3d11, immer ohne mpv.conf', () => {
  const a = args();
  assert.ok(a.includes('--wid=12345'));
  assert.ok(a.includes('--osc=no') && a.includes('--no-input-default-bindings') && a.includes('--no-input-cursor'));
  assert.ok(a.includes('--vo=gpu-next') && a.includes('--gpu-api=d3d11') && a.includes('--hwdec=auto-safe'));
  assert.ok(a.includes('--input-ipc-server=\\\\.\\pipe\\x'));
  assert.ok(a.includes('--no-config'), 'mpv.conf des Nutzers wird nie geladen');
});

test('Ohne wid entsteht ein eigenes mpv-Fenster (nur Tests/Diagnose)', () => {
  const a = args({}, { wid: null });
  assert.ok(a.includes('--osc=yes'));
  assert.ok(!a.some((x) => x.startsWith('--wid')));
});

test('mpv ist nicht konfigurierbar: keine Einstellung fuer Pfad, Konfiguration oder freie Optionen', () => {
  for (const key of ['mpvPath', 'useUserMpvConf', 'extraMpvArgs', 'mode']) assert.ok(!(key in DEFAULT_SETTINGS.player), `${key} darf nicht mehr existieren`);
  // Selbst wenn alte Konfigurationen solche Schluessel enthalten: sie haben keine Wirkung auf die Kommandozeile.
  const a = args({ extraMpvArgs: '--script=evil.lua', useUserMpvConf: true, mpvPath: 'C:\\x\\mpv.exe', mode: 'standalone' });
  assert.ok(!a.some((x) => /evil/.test(x)));
  assert.ok(a.includes('--no-config') && a.includes('--wid=12345'));
});

test('HDR-Modi und Tone-Mapping', () => {
  assert.ok(args({ hdr: 'passthrough' }).includes('--target-colorspace-hint=yes'));
  const tone = args({ hdr: 'tonemap' });
  assert.ok(tone.includes('--target-colorspace-hint=no') && tone.includes('--tone-mapping=bt.2390') && tone.includes('--hdr-compute-peak=yes'));
  assert.ok(args({ hdr: 'auto' }).includes('--target-colorspace-hint=auto'));
  assert.ok(args({ hdr: 'auto' }, { version: [0, 37, 0] }).includes('--target-colorspace-hint=yes'), 'aeltere mpv-Versionen kennen "auto" nicht');
  assert.ok(args({ toneMapping: 'hable' }).includes('--tone-mapping=hable'));
  assert.ok(!args({ toneMapping: 'rm -rf' }).some((x) => /rm -rf/.test(x)), 'unbekanntes Verfahren wird verworfen');
  assert.ok(args({ hdrPeak: 'no' }).includes('--hdr-compute-peak=no'));
});

test('Bild: Skalierung, Zeilensprung, Grafik-API, Bildanpassung', () => {
  assert.ok(args({ scalePreset: 'high' }).includes('--scale=ewa_lanczossharp'));
  assert.ok(args({ scalePreset: 'fast' }).includes('--scale=bilinear'));
  assert.ok(!args({ scalePreset: 'default' }).some((x) => x.startsWith('--scale=')));
  assert.ok(args({ deinterlace: 'yes' }).includes('--deinterlace=yes'));
  const vk = args({ gpuApi: 'vulkan' });
  assert.ok(vk.includes('--gpu-api=vulkan') && vk.includes('--gpu-context=winvk') && !vk.includes('--gpu-api=d3d11'));
  const pic = args({ brightness: 10, contrast: -5, saturation: 0, gamma: 99 });
  assert.ok(pic.includes('--brightness=10') && pic.includes('--contrast=-5') && pic.includes('--gamma=50'), 'Werte werden begrenzt');
  assert.ok(!pic.some((x) => x.startsWith('--saturation=')), '0 = unveraendert');
});

test('Audio: Passthrough nur mit WASAPI, Kanaele, Geraet, Nachtmodus', () => {
  assert.ok(!args().some((x) => x.startsWith('--audio-spdif')));
  const p = args({ audioPassthrough: true });
  assert.ok(p.includes('--ao=wasapi') && p.includes('--audio-spdif=ac3,eac3,dts,dts-hd,truehd'));
  assert.ok(!p.includes('--audio-exclusive=yes'));
  assert.ok(args({ audioPassthrough: true, audioExclusive: true }).includes('--audio-exclusive=yes'));
  assert.ok(!args({ audioPassthrough: false, audioExclusive: true }).includes('--audio-exclusive=yes'));
  assert.ok(args({ audioChannels: 'stereo' }).includes('--audio-channels=stereo'));
  assert.ok(args({}).includes('--audio-channels=auto-safe'));
  assert.ok(args({ audioDevice: 'wasapi/{abc-123}' }).includes('--audio-device=wasapi/{abc-123}'));
  assert.ok(args({ audioDevice: 'x --script=evil' }).includes('--audio-device=auto'), 'unsichere Geraetenamen werden verworfen');
  assert.ok(args({ nightMode: true }).some((x) => x.startsWith('--af=lavfi=[dynaudnorm')));
  assert.ok(!args({ nightMode: true, audioPassthrough: true }).some((x) => x.startsWith('--af=')), 'Filter und Passthrough schliessen sich aus');
});

test('Untertitel: Stil, Position, Hintergrund, ASS', () => {
  const a = args({ subtitleColor: '#ffe066', subtitleOutline: 3, subtitleBold: true, subtitleFont: 'Verdana', subtitlePos: 90, subtitleScale: 1.4 });
  for (const x of ['--sub-color=#ffe066', '--sub-border-size=3', '--sub-bold=yes', '--sub-font=Verdana', '--sub-pos=90', '--sub-scale=1.4']) assert.ok(a.includes(x), x);
  assert.ok(!a.some((x) => x.startsWith('--sub-back-color')), 'Kein Hintergrund bei 0 %');
  const bg = args({ subtitleBackground: 50 });
  assert.ok(bg.includes('--sub-border-style=background-box') && bg.includes('--sub-back-color=#80000000'));
  assert.ok(args({ subtitleColor: 'rot; --evil' }).includes('--sub-color=#ffffff'));
  assert.ok(args({ subtitleFont: 'A --script=evil' }).includes('--sub-font=Segoe UI'));
  assert.ok(args({}).includes('--sub-ass-override=scale') && args({ subtitleAssStyle: true }).includes('--sub-ass-override=force'));
});

test('Netzwerk und Puffer', () => {
  const a = args({ bufferMb: 512, readaheadSec: 90, allowSelfSigned: true });
  assert.ok(a.includes('--demuxer-max-bytes=512MiB') && a.includes('--demuxer-readahead-secs=90') && a.includes('--tls-verify=no'));
  assert.ok(args({ bufferMb: 99999 }).includes('--demuxer-max-bytes=2048MiB'), 'Obergrenze');
  assert.ok(!args({}).includes('--tls-verify=no'));
  assert.ok(args({ videoSync: 'display-resample', interpolation: true, deband: true }).includes('--video-sync=display-resample'));
});

test('Nur das mitgelieferte mpv wird gefunden (Ressourcen oder vendor), nie PATH oder frei gewaehlte Pfade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-mpv-'));
  const oldPath = process.env.PATH;
  try {
    assert.equal(findMpv({ appRoot: dir, resourcesPath: '' }), null);
    fs.mkdirSync(path.join(dir, 'vendor', 'mpv'), { recursive: true });
    const exe = path.join(dir, 'vendor', 'mpv', 'mpv.exe');
    fs.writeFileSync(exe, '');
    assert.equal(findMpv({ appRoot: dir }), exe);
    const res = path.join(dir, 'resources');
    fs.mkdirSync(path.join(res, 'mpv'), { recursive: true });
    fs.writeFileSync(path.join(res, 'mpv', 'mpv.exe'), '');
    assert.equal(findMpv({ appRoot: dir, resourcesPath: res }), path.join(res, 'mpv', 'mpv.exe'), 'installiertes mpv hat Vorrang');
    // Ein mpv im PATH wird bewusst ignoriert
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'mpv.exe'), '');
    process.env.PATH = bin;
    assert.equal(findMpv({ appRoot: path.join(dir, 'leer') }), null);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
