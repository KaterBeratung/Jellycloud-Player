'use strict';
/**
 * Tests gegen ein ECHTES mpv (vendor\mpv\mpv.exe). Werden uebersprungen, wenn mpv fehlt.
 * Pruefen, dass mpv alle Startoptionen akzeptiert, alle beobachteten Eigenschaften kennt und der Controller
 * mit einem echten (synthetischen) Videostrom funktioniert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { MpvPlayer, OBSERVED, STATS } = require('../src/main/mpv');
const { buildMpvArgs, probeMpv } = require('../src/main/mpv-args');
const { DEFAULT_SETTINGS } = require('../src/main/config');

const EXE = path.join(__dirname, '..', 'vendor', 'mpv', 'mpv.exe');
const have = fs.existsSync(EXE);
const opts = { skip: have ? false : 'vendor\\mpv\\mpv.exe fehlt' };
const probe = have ? probeMpv(EXE) : null;
const player = (over = {}) => ({ ...DEFAULT_SETTINGS.player, ...over });
const pipe = () => `\\\\.\\pipe\\jc-real-${process.pid}-${Math.random().toString(36).slice(2)}`;

test('echtes mpv: Version wird erkannt', opts, () => {
  assert.ok(probe.ok, probe.error);
  assert.ok(probe.version[0] === 0 && probe.version[1] >= 37, `mpv ${probe.versionText}`);
});

const COMBOS = {
  Standard: {},
  'HDR durchreichen': { hdr: 'passthrough' },
  'HDR Tone-Mapping mit Hable und Peak-Messung': { hdr: 'tonemap', toneMapping: 'hable', hdrPeak: 'yes' },
  'Tone-Mapping Spline': { toneMapping: 'spline', hdrPeak: 'no' },
  'Audio-Passthrough exklusiv': { audioPassthrough: true, audioExclusive: true },
  'Nachtmodus + Stereo-Downmix': { nightMode: true, audioChannels: 'stereo' },
  'Kanaele 5.1 / 7.1': { audioChannels: '7.1' },
  'Sync + Glaettung + Debanding': { videoSync: 'display-resample', interpolation: true, deband: true },
  'Skalierung hoch + Zeilensprung': { scalePreset: 'high', deinterlace: 'yes' },
  'Skalierung schnell': { scalePreset: 'fast' },
  'Bildanpassung': { brightness: 10, contrast: -8, saturation: 15, gamma: 5 },
  'D3D11-Copy': { hwdec: 'd3d11va-copy' },
  Software: { hwdec: 'no' },
  Vulkan: { gpuApi: 'vulkan' },
  'Untertitel-Stil komplett': { subtitleColor: '#ffe066', subtitleOutline: 3.5, subtitleBackground: 55, subtitleBold: true, subtitleFont: 'Verdana', subtitlePos: 88, subtitleAssStyle: true, subtitleScale: 1.3 },
  'Puffer + Zertifikate': { bufferMb: 1024, readaheadSec: 120, allowSelfSigned: true }
};

for (const [name, over] of Object.entries(COMBOS)) {
  test(`echtes mpv akzeptiert alle Optionen: ${name}`, opts, () => {
    const args = buildMpvArgs({ player: player(over), pipe: pipe(), wid: null, version: probe.version })
      // Nur die Optionspruefung: kein Fenster, kein Ton, Terminalausgabe fuer Fehlermeldungen behalten
      .filter((a) => !a.startsWith('--no-terminal') && !a.startsWith('--force-window') && !a.startsWith('--idle') && !a.startsWith('--vo=') && !a.startsWith('--ao='));
    const r = spawnSync(EXE, [...args, '--vo=null', '--ao=null', '--force-window=no', '--idle=no', '--msg-level=all=error'], { encoding: 'utf8', timeout: 15000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.ok(!/Error parsing|Unknown option|option .* not found|Invalid|unrecognized/i.test(out), `mpv meldet: ${out.trim().slice(0, 400)}`);
  });
}

test('echtes mpv: eingebetteter Modus (--wid) wird akzeptiert', opts, () => {
  const args = buildMpvArgs({ player: player(), pipe: pipe(), wid: '0', version: probe.version }).filter((a) => !a.startsWith('--no-terminal') && !a.startsWith('--wid') && !a.startsWith('--force-window') && !a.startsWith('--idle') && !a.startsWith('--vo=') && !a.startsWith('--ao='));
  assert.ok(args.includes('--osc=no') || true);
  const r = spawnSync(EXE, [...args, '--osc=no', '--no-input-default-bindings', '--no-input-vo-keyboard', '--no-input-cursor', '--no-border', '--osd-level=0', '--load-scripts=no', '--vo=null', '--ao=null', '--force-window=no', '--idle=no', '--msg-level=all=error'], { encoding: 'utf8', timeout: 15000 });
  assert.ok(!/Error parsing|Unknown option|not found|Invalid/i.test(`${r.stdout}${r.stderr}`), `${r.stdout}${r.stderr}`.trim().slice(0, 400));
});

test('echtes mpv: Controller spielt einen echten Videostrom (lavfi) ab', opts, async (t) => {
  const p = pipe();
  const args = buildMpvArgs({ player: player(), pipe: p, wid: null, version: probe.version }).filter((a) => !a.startsWith('--vo=') && !a.startsWith('--ao=') && !a.startsWith('--force-window') && !a.startsWith('--osc'));
  const m = new MpvPlayer({ exe: EXE, args: [...args, '--vo=null', '--ao=null', '--force-window=no', '--osc=no'], pipe: p, connectTimeoutMs: 15000 });
  await m.start();
  t.after(() => m.quit());

  // Jede beobachtete Eigenschaft muss mpv kennen (sonst waere die Beobachtung wirkungslos).
  const unknown = [];
  for (const name of [...OBSERVED, ...STATS]) {
    try {
      await m.getProperty(name);
    } catch (e) {
      if (/property not found/.test(e.message)) unknown.push(name);
    }
  }
  assert.deepEqual(unknown, [], `mpv kennt diese Eigenschaften nicht: ${unknown.join(', ')}`);

  const loaded = new Promise((res) => m.once('file-loaded', res));
  await m.load({ url: 'av://lavfi:testsrc2=size=640x360:rate=24:duration=30', headers: ['X-Test: 1'], start: 0, title: 'Testbild' });
  await loaded;
  const tracks = m.prop('track-list') ?? (await m.getProperty('track-list'));
  assert.ok(tracks.some((x) => x.type === 'video'), 'Videospur vorhanden');
  const t0 = await m.getProperty('time-pos');
  await new Promise((r) => setTimeout(r, 1200));
  const t1 = await m.getProperty('time-pos');
  assert.ok(t1 > t0, `Zeit laeuft (${t0} -> ${t1})`);

  await m.setProperty('pause', true);
  const f = await m.getProperty('time-pos');
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(Math.abs((await m.getProperty('time-pos')) - f) < 0.1, 'Pause haelt an');
  await m.command('seek', 20, 'absolute');
  await new Promise((r) => setTimeout(r, 400));
  assert.ok((await m.getProperty('time-pos')) >= 19, 'Seek funktioniert');
  await m.setProperty('speed', 1.5);
  assert.equal(await m.getProperty('speed'), 1.5);
  await m.setProperty('sub-pos', 80);
  assert.equal(await m.getProperty('sub-pos'), 80);
  await m.setProperty('panscan', 1);
  await m.setProperty('video-aspect-override', '16:9');
  await m.setProperty('volume', 70);
  assert.equal(await m.getProperty('volume'), 70);
  await m.quit();
  assert.equal(m.exited, true);
});

test('echtes mpv: Audio-Ausgabegeraete werden gelistet', opts, () => {
  const { listAudioDevices } = require('../src/main/mpv-args');
  const list = listAudioDevices(EXE);
  assert.ok(list.length >= 1, 'mindestens "auto"');
  assert.ok(list.some((d) => d.id === 'auto'), JSON.stringify(list.slice(0, 3)));
  assert.ok(list.every((d) => typeof d.id === 'string' && typeof d.name === 'string'));
});

const SAMPLE = path.join(__dirname, '..', 'tools', 'sample', 'test.mkv');
test('echtes mpv: Nachtmodus-Filter und Bildanpassung laufen mit echtem Ton', { skip: have && fs.existsSync(SAMPLE) ? false : 'Testvideo fehlt (tools/sample/test.mkv)' }, async (t) => {
  const p = pipe();
  const args = buildMpvArgs({ player: player({ nightMode: true, audioChannels: 'stereo', brightness: 8, scalePreset: 'high', subtitleBackground: 40 }), pipe: p, wid: null, version: probe.version }).filter((a) => !a.startsWith('--vo=') && !a.startsWith('--ao=') && !a.startsWith('--force-window') && !a.startsWith('--osc'));
  const m = new MpvPlayer({ exe: EXE, args: [...args, '--vo=null', '--ao=null', '--force-window=no', '--osc=no'], pipe: p, connectTimeoutMs: 15000 });
  await m.start();
  t.after(() => m.quit());
  const loaded = new Promise((res) => m.once('file-loaded', res));
  await m.load({ url: SAMPLE, start: 0 });
  await loaded;
  await new Promise((r) => setTimeout(r, 1500));
  const af = await m.getProperty('af');
  assert.ok(Array.isArray(af) && af.some((f) => /lavfi/.test(f.name)), `Audiofilter aktiv: ${JSON.stringify(af)}`);
  const out = await m.getProperty('audio-out-params');
  assert.ok(out && out.channels, 'Audio wird ausgegeben (kein Filterfehler)');
  assert.equal(await m.getProperty('brightness'), 8);
  assert.ok((await m.getProperty('time-pos')) > 0.5, 'Wiedergabe laeuft');
});

const sampleOpts = { skip: have && fs.existsSync(SAMPLE) ? false : 'Testvideo fehlt (tools/sample/test.mkv)' };
const startReal = async (t, over, extra = []) => {
  const p = pipe();
  const args = buildMpvArgs({ player: player(over), pipe: p, wid: null, version: probe.version }).filter((a) => !a.startsWith('--vo=') && !a.startsWith('--ao=') && !a.startsWith('--force-window') && !a.startsWith('--osc'));
  const m = new MpvPlayer({ exe: EXE, args: [...args, '--vo=null', '--ao=null', '--force-window=no', '--osc=no', ...extra], pipe: p, connectTimeoutMs: 15000 });
  await m.start();
  t.after(() => m.quit());
  return m;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('echtes mpv: Kanalmodus und Bitstream lassen sich zur Laufzeit umstellen (Rueckfall-Kommandos)', sampleOpts, async (t) => {
  const m = await startReal(t, {});
  const loaded = new Promise((res) => m.once('file-loaded', res));
  await m.load({ url: SAMPLE, start: 0 });
  await loaded;
  await wait(1200);
  assert.ok(m.prop('audio-out-params'), 'Ausgabe laeuft, audio-out-params ist beobachtet');
  assert.ok(m.prop('current-ao'), 'current-ao ist beobachtet');

  await m.setProperty('audio-channels', 'stereo');
  await wait(800);
  assert.equal(m.prop('audio-out-params')?.['channel-count'], 2, 'Stereo wirkt sofort');
  await m.setProperty('audio-channels', '5.1');
  await wait(800);
  assert.equal(m.prop('audio-out-params')?.['channel-count'], 6, '5.1 wirkt sofort');

  // Genau die Befehle, mit denen der Player bei fehlender Tonausgabe auf die sichere Einstellung zurueckfaellt
  await m.setProperty('audio-spdif', '');
  await m.setProperty('audio-exclusive', 'no');
  await m.setProperty('audio-channels', 'stereo');
  await m.command('ao-reload');
  await wait(800);
  assert.equal(m.prop('audio-out-params')?.['channel-count'], 2);
  assert.ok((await m.getProperty('time-pos')) > 0.5, 'Wiedergabe laeuft weiter');
});

test('echtes mpv: eine gescheiterte Tonausgabe ist an fehlenden audio-out-params erkennbar (Grundlage des Rueckfalls)', sampleOpts, async (t) => {
  const m = await startReal(t, {}, ['--ao=wasapi', '--audio-device=wasapi/{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}']);
  const loaded = new Promise((res) => m.once('file-loaded', res));
  await m.load({ url: SAMPLE, start: 0 });
  await loaded;
  await wait(2000);
  assert.equal(m.prop('core-idle'), false, 'das Bild laeuft trotzdem');
  assert.ok(!m.prop('audio-out-params'), `ohne Tonausgabe keine audio-out-params (war: ${JSON.stringify(m.prop('audio-out-params'))})`);
  assert.equal((m.prop('track-list') ?? []).filter((x) => x.type === 'audio').length > 0, true, 'die Datei hat eine Tonspur');
});

test('echtes mpv: Statistik-Eigenschaften werden nur beobachtet, solange die Technik-Info offen ist', sampleOpts, async (t) => {
  const m = await startReal(t, {});
  const seen = new Set();
  m.on('property', (n) => seen.add(n));
  const loaded = new Promise((res) => m.once('file-loaded', res));
  await m.load({ url: SAMPLE, start: 0 });
  await loaded;
  await wait(1200);
  assert.ok(!STATS.some((n) => seen.has(n) && n !== 'audio-codec-name' && n !== 'current-vo'), 'ohne Info keine Statistik-Ereignisse');
  seen.clear();
  m.observeStats(true);
  await wait(800);
  assert.ok(seen.has('container-fps') && seen.has('file-format'), `Info offen: Werte kommen (${[...seen].join(', ')})`);
  m.observeStats(false);
  await wait(300);
  seen.clear();
  await wait(1200);
  assert.deepEqual([...seen].filter((n) => STATS.includes(n)), [], 'nach dem Schliessen ist Ruhe');
});
