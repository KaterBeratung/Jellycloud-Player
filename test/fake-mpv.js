#!/usr/bin/env node
'use strict';

/**
 * Simulierter mpv-Prozess fuer Tests: spricht das JSON-IPC-Protokoll ueber eine Named Pipe,
 * simuliert Laden, Zeitfortschritt, Seek, Spuren und Ende. Kein Video, kein Fenster.
 * Aufruf wie mpv: node fake-mpv.js --input-ipc-server=<pipe> [weitere mpv-Optionen]
 * Steuerung per Umgebung: FAKE_DURATION (Sekunden, Standard 5400), FAKE_LOG (Datei fuer empfangene Befehle),
 * FAKE_NO_AO=1 (Tonausgabe laesst sich nicht oeffnen, bis ao-reload mit Stereo kommt), FAKE_DEVICE_CHANNELS (Kanaele bei "auto-safe", Standard 2),
 * FAKE_FAIL_DIRECT=1 (Direct-Play-URLs /stream schlagen mit einem Ladefehler fehl; HLS-URLs laufen).
 */

const net = require('node:net');
const fs = require('node:fs');

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('mpv 0.40.0 (fake)');
  process.exit(0);
}
const pipe = argv.find((a) => a.startsWith('--input-ipc-server='))?.split('=').slice(1).join('=');
if (!pipe) {
  console.error('fake-mpv: --input-ipc-server fehlt');
  process.exit(2);
}
const DURATION = Number(process.env.FAKE_DURATION ?? 5400);
const logFile = process.env.FAKE_LOG;
const log = (obj) => logFile && fs.appendFileSync(logFile, `${JSON.stringify(obj)}\n`);
log({ args: argv });

const props = {
  pause: false, volume: 100, mute: false, speed: 1, 'eof-reached': false, 'core-idle': true, 'paused-for-cache': false, seekable: true,
  'time-pos': null, duration: null, 'track-list': [], 'chapter-list': [], chapter: null, aid: 'auto', sid: 'no', start: 'none',
  'video-params': null, 'hwdec-current': 'no', 'current-vo': 'gpu-next', 'audio-codec-name': null, 'video-codec': null, 'file-format': null,
  'container-fps': null, 'frame-drop-count': 0, 'decoder-frame-drop-count': 0, 'demuxer-cache-time': 0, 'sub-delay': 0, 'audio-delay': 0, 'sub-scale': 1,
  'video-aspect-override': '-1', panscan: 0, 'sub-pos': 100,
  'audio-channels': 'auto-safe', 'audio-spdif': '', 'audio-exclusive': 'no', 'current-ao': null, 'audio-out-params': null
};
const observers = new Map(); // name -> id
let noAo = process.env.FAKE_NO_AO === '1';
let sockets = [];
let loaded = false;
let extraSubs = 0;

const send = (sock, obj) => sock.writable && sock.write(`${JSON.stringify(obj)}\n`);
const broadcast = (obj) => sockets.forEach((s) => send(s, obj));
function setProp(name, value) {
  props[name] = value;
  if (observers.has(name)) broadcast({ event: 'property-change', id: observers.get(name), name, data: value });
}

function tracks() {
  const aid = props.aid === 'auto' ? 1 : Number(props.aid);
  const sid = props.sid === 'no' ? 0 : Number(props.sid);
  const list = [
    { id: 1, type: 'video', codec: 'hevc', selected: true },
    { id: 1, type: 'audio', codec: 'truehd', lang: 'eng', title: 'English - Dolby TrueHD Atmos - 7.1', 'demux-channel-count': 8, selected: aid === 1, default: true },
    { id: 2, type: 'audio', codec: 'ac3', lang: 'ger', title: 'Deutsch - Dolby Digital - 5.1', 'demux-channel-count': 6, selected: aid === 2 },
    { id: 1, type: 'sub', codec: 'subrip', lang: 'eng', title: 'English - SubRip', selected: sid === 1 },
    { id: 2, type: 'sub', codec: 'hdmv_pgs_subtitle', lang: 'ger', title: 'Deutsch - PGSSUB', selected: sid === 2 },
    { id: 3, type: 'sub', codec: 'subrip', lang: 'ger', title: 'Deutsch - Erzwungen', forced: true, selected: sid === 3 }
  ];
  // FAKE_SUBS=n: n zusaetzliche Untertitelspuren (fuer Layout-Tests mit langen Listen)
  const langs = ['eng', 'fra', 'spa', 'ita', 'por', 'pol', 'rus', 'tur', 'jpn', 'kor', 'nld', 'swe'];
  for (let i = 0; i < Number(process.env.FAKE_SUBS ?? 0); i++) list.push({ id: 100 + i, type: 'sub', codec: 'subrip', lang: langs[i % langs.length], title: `Zusatz ${i + 1}`, selected: sid === 100 + i });
  for (let i = 0; i < extraSubs; i++) list.push({ id: 4 + i, type: 'sub', codec: 'subrip', lang: 'ger', title: 'Extern', external: true, selected: sid === 4 + i });
  return list;
}

/** Tonausgabe nach Einstellung oeffnen (oder nicht, solange FAKE_NO_AO gilt). */
function updateAo() {
  if (!loaded || noAo) {
    setProp('current-ao', null);
    setProp('audio-out-params', null);
    return;
  }
  const ch = { stereo: 2, '5.1': 6, '7.1': 8 }[props['audio-channels']] ?? Number(process.env.FAKE_DEVICE_CHANNELS ?? 2);
  const layout = { 2: 'stereo', 6: '5.1', 8: '7.1' }[ch] ?? `${ch}ch`;
  setProp('current-ao', 'wasapi');
  setProp('audio-out-params', { format: props['audio-spdif'] ? 'spdif-ac3' : 'floatp', samplerate: 48000, channels: layout, 'channel-count': ch, 'hr-channels': layout });
}

function finishLoad() {
  loaded = true;
  updateAo();
  const start = props.start === 'none' ? 0 : Number(props.start) || 0;
  setProp('duration', DURATION);
  setProp('time-pos', start);
  setProp('track-list', tracks());
  setProp('chapter-list', Array.from({ length: 6 }, (_, i) => ({ title: `Kapitel ${i + 1}`, time: (DURATION / 6) * i })));
  setProp('video-params', { w: 3840, h: 2160, pixelformat: 'yuv420p10', colormatrix: 'bt.2020-ncl', gamma: 'pq', primaries: 'bt.2020', 'sig-peak': 10 });
  setProp('hwdec-current', 'd3d11va');
  setProp('audio-codec-name', 'truehd');
  setProp('video-codec', 'hevc');
  setProp('file-format', 'matroska');
  setProp('container-fps', 23.976);
  setProp('core-idle', false);
  setProp('eof-reached', false);
  broadcast({ event: 'file-loaded' });
}

setInterval(() => {
  if (!loaded || props.pause || props['eof-reached']) return;
  const next = Math.min(DURATION, props['time-pos'] + 0.25 * props.speed);
  setProp('time-pos', next);
  if (next >= DURATION) setProp('eof-reached', true);
}, 250);

function handle(sock, msg) {
  const [cmd, ...a] = msg.command ?? [];
  log({ cmd, args: a });
  const ok = (data = null) => send(sock, { error: 'success', data, ...(msg.request_id !== undefined ? { request_id: msg.request_id } : {}) });
  switch (cmd) {
    case 'observe_property':
      observers.set(a[1], a[0]);
      ok();
      send(sock, { event: 'property-change', id: a[0], name: a[1], data: props[a[1]] ?? null });
      return;
    case 'unobserve_property':
      for (const [name, id] of observers) if (id === a[0]) observers.delete(name);
      return ok();
    case 'set_property':
      setProp(a[0], a[1]);
      if (a[0] === 'aid' || a[0] === 'sid') setProp('track-list', tracks());
      if (a[0] === 'audio-channels' || a[0] === 'audio-spdif') updateAo();
      return ok();
    case 'ao-reload':
      // Ein gescheiterter Start mit Bitstream/Surround klappt erst mit der sicheren Einstellung (PCM-Stereo)
      if (props['audio-channels'] === 'stereo' && !props['audio-spdif']) noAo = false;
      updateAo();
      return ok();
    case 'get_property':
      return ok(props[a[0]] ?? null);
    case 'loadfile':
      broadcast({ event: 'start-file' });
      loaded = false;
      extraSubs = 0;
      setProp('eof-reached', false);
      updateAo();
      ok();
      if (process.env.FAKE_FAIL_DIRECT === '1' && /\/Videos\/[^/]+\/stream/.test(String(a[0]))) {
        setTimeout(() => broadcast({ event: 'end-file', reason: 'error', file_error: 'loading failed' }), 150);
        return;
      }
      setTimeout(finishLoad, 250);
      return;
    case 'seek': {
      const to = a[1] === 'relative' ? props['time-pos'] + a[0] : a[0];
      setProp('time-pos', Math.min(DURATION, Math.max(0, to)));
      setProp('eof-reached', false);
      broadcast({ event: 'seek' });
      return ok();
    }
    case 'sub-add':
      extraSubs += 1;
      if (a[1] === 'select') setProp('sid', 3 + extraSubs);
      setProp('track-list', tracks());
      return ok();
    case 'quit':
      ok();
      setTimeout(() => process.exit(0), 30);
      return;
    default:
      return ok();
  }
}

const server = net.createServer((sock) => {
  sockets.push(sock);
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        handle(sock, JSON.parse(line));
      } catch (e) {
        send(sock, { error: `invalid: ${e.message}` });
      }
    }
  });
  sock.on('close', () => (sockets = sockets.filter((s) => s !== sock)));
  sock.on('error', () => {});
});
server.listen(pipe);
process.on('SIGTERM', () => process.exit(0));
