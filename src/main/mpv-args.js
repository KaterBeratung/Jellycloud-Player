'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** "mpv 0.39.0-..." oder "mpv v0.40.0" -> [0, 40, 0] */
function parseMpvVersion(text) {
  const m = /mpv[^\d]*(\d+)\.(\d+)(?:\.(\d+))?/i.exec(String(text ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function versionAtLeast(v, major, minor) {
  return !!v && (v[0] > major || (v[0] === major && v[1] >= minor));
}

/**
 * Findet das fest eingebaute mpv: im installierten Programm (resources\mpv) oder im Projekt (vendor\mpv).
 * Es gibt bewusst keine freie Pfadauswahl und keine Suche im PATH.
 * @returns {string|null}
 */
function findMpv({ resourcesPath = '', appRoot = '' } = {}) {
  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'mpv', 'mpv.exe'));
  if (appRoot) candidates.push(path.join(appRoot, 'vendor', 'mpv', 'mpv.exe'));
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* naechster Kandidat */
    }
  }
  return null;
}

/** Fragt `mpv --version` ab, damit wir nur Optionen verwenden, die diese Version kennt. */
function probeMpv(exe) {
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 8000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const version = parseMpvVersion(out);
    if (!version) return { ok: false, error: 'Keine mpv-Version erkannt', exe };
    return { ok: true, exe, version, versionText: version.join('.'), firstLine: out.split(/\r?\n/)[0] };
  } catch (e) {
    return { ok: false, error: e.message, exe };
  }
}

/**
 * Listet die Audio-Ausgabegeraete, die mpv sieht (`--audio-device=help`).
 * @returns {{id:string, name:string}[]}
 */
function listAudioDevices(exe) {
  try {
    const r = spawnSync(exe, ['--no-config', '--audio-device=help'], { encoding: 'utf8', timeout: 10000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const list = [];
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*'([^']+)'\s*\((.*)\)\s*$/.exec(line);
      if (m) list.push({ id: m[1], name: m[2] });
    }
    return list;
  } catch {
    return [];
  }
}

const TONE_MAPPINGS = new Set(['auto', 'bt.2390', 'spline', 'mobius', 'reinhard', 'hable', 'clip']);
const SCALE_PRESETS = {
  fast: ['--scale=bilinear', '--cscale=bilinear', '--dscale=bilinear'],
  default: [],
  high: ['--scale=ewa_lanczossharp', '--cscale=ewa_lanczossharp', '--dscale=mitchell', '--correct-downscaling=yes', '--linear-downscaling=yes', '--sigmoid-upscaling=yes']
};

const clampNum = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const isHex = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s));
/** Schriftname nur aus harmlosen Zeichen (kein Einschleusen weiterer Optionen). */
const safeFont = (s) => (/^[\p{L}\p{N} ._-]{1,60}$/u.test(String(s)) ? String(s) : 'Segoe UI');
const safeDevice = (s) => (/^[\w/{}\-.:() ]{1,200}$/.test(String(s)) ? String(s) : 'auto');

/**
 * Baut die mpv-Kommandozeile. Rein funktional und damit testbar.
 * @param {object} o
 * @param {object} o.player   settings.player
 * @param {string} o.pipe     Name der IPC-Pipe
 * @param {string|null} o.wid Fenster-Handle (decimal) zum Einbetten; ohne wid entsteht ein eigenes mpv-Fenster (nur Tests/Diagnose)
 * @param {number[]|null} o.version mpv-Version
 * @param {{channels:string, passthrough:boolean, exclusive:boolean}|null} [o.audio] Ergebnis von resolveAudioOutput (audio-output.js);
 *        ohne Angabe gelten die Einstellungen unveraendert
 */
function buildMpvArgs({ player, pipe, wid = null, version = null, title = 'Jellycloud Player', audio = null }) {
  const embedded = !!wid;
  const p = player;
  const args = ['--no-config'];
  args.push(
    `--input-ipc-server=${pipe}`,
    '--idle=yes',
    '--force-window=yes',
    '--keep-open=always',
    '--no-terminal',
    '--msg-level=all=warn',
    `--title=${title}`,
    '--user-agent=JellycloudPlayer/0.1',
    '--ytdl=no',
    '--save-position-on-quit=no',
    '--cursor-autohide=1000'
  );

  // ---- Bild: gpu-next (libplacebo) bildet HDR10 / HLG / Dolby Vision (Profil 5 / 8) korrekt ab ----
  if (p.gpuApi === 'vulkan') args.push('--vo=gpu-next', '--gpu-api=vulkan', '--gpu-context=winvk');
  else args.push('--vo=gpu-next', '--gpu-api=d3d11', '--gpu-context=d3d11');
  args.push(`--hwdec=${p.hwdec || 'auto-safe'}`);
  if (p.hdr === 'passthrough') args.push('--target-colorspace-hint=yes');
  else if (p.hdr === 'tonemap') args.push('--target-colorspace-hint=no', '--hdr-compute-peak=yes');
  else args.push(versionAtLeast(version, 0, 39) ? '--target-colorspace-hint=auto' : '--target-colorspace-hint=yes');
  const tone = TONE_MAPPINGS.has(p.toneMapping) ? p.toneMapping : 'auto';
  if (tone !== 'auto') args.push(`--tone-mapping=${tone}`);
  else if (p.hdr === 'tonemap') args.push('--tone-mapping=bt.2390');
  if (['yes', 'no'].includes(p.hdrPeak)) args.push(`--hdr-compute-peak=${p.hdrPeak}`);
  args.push(...(SCALE_PRESETS[p.scalePreset] ?? []));
  if (p.deinterlace === 'yes') args.push('--deinterlace=yes');
  if (p.videoSync === 'display-resample') args.push('--video-sync=display-resample');
  if (p.interpolation) args.push('--interpolation=yes', '--tscale=oversample');
  if (p.deband) args.push('--deband=yes');
  for (const key of ['brightness', 'contrast', 'saturation', 'gamma']) {
    const v = Math.round(clampNum(p[key], -50, 50));
    if (v !== 0) args.push(`--${key}=${v}`);
  }

  // ---- Ton: Passthrough nur mit WASAPI; Bitstream von TrueHD/DTS-HD braucht den exklusiven Modus ----
  const channels = { stereo: 'stereo', '5.1': '5.1', '7.1': '7.1', 'auto-safe': 'auto-safe' }[audio?.channels ?? p.audioChannels];
  const passthrough = audio ? !!audio.passthrough : !!p.audioPassthrough;
  const exclusive = audio ? !!audio.exclusive : !!p.audioExclusive;
  args.push(`--audio-channels=${channels ?? 'auto-safe'}`);
  if (p.audioDevice && p.audioDevice !== 'auto') args.push(`--audio-device=${safeDevice(p.audioDevice)}`);
  if (passthrough) {
    args.push('--ao=wasapi', '--audio-spdif=ac3,eac3,dts,dts-hd,truehd');
    if (exclusive) args.push('--audio-exclusive=yes');
  } else if (p.nightMode) {
    // Filter vertragen sich nicht mit Bitstream-Passthrough, daher nur ohne.
    args.push('--af=lavfi=[dynaudnorm=f=150:g=15:p=0.9]');
  }

  // ---- Netzwerk / Puffer fuer grosse Remux-Dateien ----
  if (p.allowSelfSigned) args.push('--tls-verify=no');
  const buffer = Math.round(clampNum(p.bufferMb, 32, 2048, 256));
  args.push('--cache=yes', `--demuxer-max-bytes=${buffer}MiB`, `--demuxer-max-back-bytes=${Math.max(32, Math.round(buffer / 3))}MiB`, `--demuxer-readahead-secs=${Math.round(clampNum(p.readaheadSec, 5, 300, 40))}`, '--network-timeout=30');
  // Kurze Netzabbrueche (WLAN, Server-Neustart des Transcoders) ueberbruecken, statt die Wiedergabe mit einem Fehler zu beenden.
  args.push('--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5');

  // ---- Untertitel ----
  args.push('--sub-auto=no', '--embeddedfonts=yes', `--sub-scale=${clampNum(p.subtitleScale, 0.3, 3, 1)}`, `--sub-pos=${Math.round(clampNum(p.subtitlePos, 0, 100, 100))}`);
  args.push(`--sub-color=${isHex(p.subtitleColor) ? p.subtitleColor : '#ffffff'}`, `--sub-border-size=${clampNum(p.subtitleOutline, 0, 10, 2)}`, '--sub-border-color=#000000');
  args.push(`--sub-bold=${p.subtitleBold ? 'yes' : 'no'}`, `--sub-font=${safeFont(p.subtitleFont)}`);
  const bg = Math.round(clampNum(p.subtitleBackground, 0, 100, 0));
  if (bg > 0 && versionAtLeast(version ?? [0, 41, 0], 0, 40)) {
    const alpha = Math.round((bg / 100) * 255).toString(16).padStart(2, '0');
    args.push('--sub-border-style=background-box', `--sub-back-color=#${alpha}000000`);
  }
  args.push(`--sub-ass-override=${p.subtitleAssStyle ? 'force' : 'scale'}`);

  if (embedded) {
    // Eingebettet: die Jellycloud-Oberflaeche uebernimmt Maus und Tastatur komplett.
    args.push(`--wid=${wid}`, '--osc=no', '--osd-level=0', '--load-scripts=no', '--no-input-default-bindings', '--no-input-vo-keyboard', '--no-input-cursor', '--no-border');
  } else {
    args.push('--osc=yes', '--autofit-larger=90%x90%');
  }
  return args;
}

module.exports = { parseMpvVersion, versionAtLeast, findMpv, probeMpv, listAudioDevices, buildMpvArgs, TONE_MAPPINGS, SCALE_PRESETS };
