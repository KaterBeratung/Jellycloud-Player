'use strict';

const { execFile } = require('node:child_process');

/**
 * Erkennung des Windows-Ausgabegeraets (Kanalzahl, Bauart) und daraus abgeleitete Ton-Einstellungen fuer mpv.
 *
 * Problem, das das loest: Bei "Auto" liess die App mpv den Surround-Ton unveraendert ausgeben. Haengt an einem Stereo-System
 * (Kopfhoerer, Optical/HDMI zu einem Verstaerker ohne Decoder, Windows auf 5.1 gestellt) nichts Passendes, bleibt es still:
 * ein Bitstream (AC3/DTS) kommt bei einem Geraet ohne Decoder nicht an, Mittel-/Surround-Kanaele landen auf nicht vorhandenen Lautsprechern.
 */

/** EndpointFormFactor aus der Windows Core Audio API */
const FORM = { REMOTE: 0, SPEAKERS: 1, LINE: 2, HEADPHONES: 3, MIC: 4, HEADSET: 5, HANDSET: 6, DIGITAL: 7, SPDIF: 8, HDMI: 9, UNKNOWN: 10 };
/** Nur an diesen Ausgaengen kann ein Bitstream (AC3/DTS/TrueHD) ueberhaupt ankommen. */
const DIGITAL_FORMS = new Set([FORM.DIGITAL, FORM.SPDIF, FORM.HDMI]);
/** Diese Geraete sind praktisch immer Stereo, auch wenn Windows mehr Kanaele meldet. */
const STEREO_FORMS = new Set([FORM.HEADPHONES, FORM.HEADSET, FORM.HANDSET, FORM.REMOTE]);

/**
 * Fragt alle aktiven Wiedergabe-Endpunkte samt Standardgeraet ab (Core Audio per PowerShell + C#, ohne Native-Modul).
 * Ausgabe: JSON-Liste [{ id, name, form, channels, mask, physical, default }].
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class AudProbe {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IEnum {
    int EnumAudioEndpoints(int flow, int mask, out IColl c);
    int GetDefaultAudioEndpoint(int flow, int role, out IDev d);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IColl { int GetCount(out int n); int Item(int i, out IDev d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDev {
    int Activate(ref Guid iid, int ctx, IntPtr p, out IntPtr o);
    int OpenPropertyStore(int access, out IStore s);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int st);
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IStore { int GetCount(out int n); int GetAt(int i, out Key k); int GetValue(ref Key k, IntPtr v); int SetValue(ref Key k, IntPtr v); int Commit(); }
  [StructLayout(LayoutKind.Sequential)] struct Key { public Guid g; public int pid; }
  [DllImport("ole32.dll")] static extern int PropVariantClear(IntPtr pv);

  static readonly Guid DEVFMT = new Guid("f19f064d-082c-4e27-bc73-6882a1bb8e4c");
  static readonly Guid ENDPT = new Guid("1da5d803-d492-4edd-8e23-e0c0ffee7f0e");
  static readonly Guid DEVPROP = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");

  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }

  static bool Get(IStore st, Guid g, int pid, IntPtr pv) {
    Key k = new Key(); k.g = g; k.pid = pid;
    for (int i = 0; i < 32; i++) Marshal.WriteByte(pv, i, 0);
    return st.GetValue(ref k, pv) == 0;
  }

  static string One(IDev d, string defId) {
    string id; d.GetId(out id);
    IStore st; d.OpenPropertyStore(0, out st);
    IntPtr pv = Marshal.AllocCoTaskMem(32);
    string name = ""; int form = 10, channels = 0, mask = 0, physical = 0;
    try {
      if (Get(st, DEVPROP, 14, pv) && Marshal.ReadInt16(pv) == 31) { IntPtr p = Marshal.ReadIntPtr(pv, 8); if (p != IntPtr.Zero) name = Marshal.PtrToStringUni(p); }
      PropVariantClear(pv);
      if (Get(st, ENDPT, 0, pv) && Marshal.ReadInt16(pv) == 19) form = Marshal.ReadInt32(pv, 8);
      PropVariantClear(pv);
      if (Get(st, ENDPT, 3, pv) && Marshal.ReadInt16(pv) == 19) physical = Marshal.ReadInt32(pv, 8);
      PropVariantClear(pv);
      if (Get(st, DEVFMT, 0, pv) && Marshal.ReadInt16(pv) == 65) {
        int size = Marshal.ReadInt32(pv, 8); IntPtr b = Marshal.ReadIntPtr(pv, 8 + IntPtr.Size);
        if (b != IntPtr.Zero && size >= 18) {
          channels = (ushort)Marshal.ReadInt16(b, 2);
          if (size >= 40 && (ushort)Marshal.ReadInt16(b, 0) == 0xFFFE) mask = Marshal.ReadInt32(b, 20);
        }
      }
      PropVariantClear(pv);
    } finally { Marshal.FreeCoTaskMem(pv); }
    return "{\"id\":\"" + Esc(id) + "\",\"name\":\"" + Esc(name) + "\",\"form\":" + form + ",\"channels\":" + channels + ",\"mask\":" + mask + ",\"physical\":" + physical + ",\"default\":" + (id == defId ? "true" : "false") + "}";
  }

  public static string Probe() {
    IEnum e = (IEnum)new Enumerator();
    string defId = "";
    try { IDev dd; if (e.GetDefaultAudioEndpoint(0, 1, out dd) == 0) dd.GetId(out defId); } catch { }
    IColl c; e.EnumAudioEndpoints(0, 1, out c);
    int n; c.GetCount(out n);
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < n; i++) { IDev d; c.Item(i, out d); if (i > 0) sb.Append(","); sb.Append(One(d, defId)); }
    return sb.Append("]").ToString();
  }
}
'@
[Console]::Out.WriteLine([AudProbe]::Probe())
`;

function normalizeEndpoint(e) {
  return {
    id: String(e.id ?? ''),
    name: String(e.name ?? ''),
    form: Number.isFinite(+e.form) ? +e.form : FORM.UNKNOWN,
    channels: Number.isFinite(+e.channels) ? +e.channels : 0,
    mask: Number.isFinite(+e.mask) ? +e.mask : 0,
    physical: Number.isFinite(+e.physical) ? +e.physical : 0,
    default: !!e.default
  };
}

/** Liest die JSON-Zeile des Hilfsskripts; null bei allem, was keine Liste ist. */
function parseProbeOutput(text) {
  try {
    const line = String(text ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
    const list = JSON.parse(line);
    return Array.isArray(list) ? list.map(normalizeEndpoint).filter((e) => e.id) : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<ReturnType<typeof normalizeEndpoint>[]|null>} null, wenn die Abfrage nicht moeglich ist (dann gilt "Auto" wie bisher) */
function probeAudioEndpoints({ execFileImpl = execFile, timeoutMs = 20000, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') return resolve(null);
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    try {
      execFileImpl(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1 << 20 },
        (err, stdout) => resolve(err ? null : parseProbeOutput(stdout))
      );
    } catch {
      resolve(null);
    }
  });
}

/** Haelt das letzte Ergebnis vor, damit der Start der Wiedergabe nicht auf PowerShell warten muss. */
class AudioOutputProbe {
  constructor({ probe = probeAudioEndpoints, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
    this.probe = probe;
    this.ttlMs = ttlMs;
    this.now = now;
    this.endpoints = null;
    this.at = 0;
    this._running = null;
  }

  /** Letzte bekannte Geraete (oder null). */
  get() {
    return this.endpoints;
  }

  /** Fragt neu ab (nie zwei Abfragen gleichzeitig). */
  refresh() {
    if (this._running) return this._running;
    this._running = Promise.resolve(this.probe())
      .then((list) => {
        if (list) {
          this.endpoints = list;
          this.at = this.now();
        }
        return this.endpoints;
      })
      .catch(() => this.endpoints)
      .finally(() => {
        this._running = null;
      });
    return this._running;
  }

  /** Liefert sofort den Zwischenstand und frischt im Hintergrund auf, wenn er alt ist. */
  ensureFresh() {
    if (!this.endpoints || this.now() - this.at > this.ttlMs) this.refresh();
    return this.endpoints;
  }
}

/** 'wasapi/{0.0.0.00000000}.{guid}' (mpv-Geraetename) -> Endpunkt-ID */
function endpointIdFromSetting(setting) {
  const m = /^wasapi\/(.+)$/i.exec(String(setting ?? ''));
  return m ? m[1] : null;
}

/** Gewaehltes Geraet, sonst das Windows-Standardgeraet; null, wenn unbekannt. */
function pickDevice(endpoints, setting) {
  if (!Array.isArray(endpoints) || !endpoints.length) return null;
  const id = endpointIdFromSetting(setting);
  if (id) return endpoints.find((e) => e.id.toLowerCase() === id.toLowerCase()) ?? null;
  return endpoints.find((e) => e.default) ?? null;
}

const MANUAL = { stereo: 2, '5.1': 6, '7.1': 8 };

/**
 * Entscheidet, wie mpv den Ton ausgibt.
 * @param {{player:object, endpoints?:object[]|null}} o  player = settings.player
 * @returns {{channels:'auto-safe'|'stereo'|'5.1'|'7.1', passthrough:boolean, exclusive:boolean, device:object|null, outChannels:number|null, reasons:string[]}}
 *   outChannels: wie viele Kanaele die Ausgabe voraussichtlich hat (2 = Stereo), null = unbekannt oder Bitstream (Receiver dekodiert).
 */
function resolveAudioOutput({ player, endpoints = null }) {
  const p = player ?? {};
  const device = pickDevice(endpoints, p.audioDevice);
  const reasons = [];
  let passthrough = !!p.audioPassthrough;
  // Bitstream nur an digitalen Ausgaengen: Kopfhoerer, Lautsprecher-Klinke oder Bluetooth koennen AC3/DTS nicht abspielen (Stille).
  if (passthrough && device && !DIGITAL_FORMS.has(device.form)) {
    passthrough = false;
    reasons.push('passthrough-needs-digital');
  }

  let channels;
  let outChannels;
  if (MANUAL[p.audioChannels]) {
    channels = p.audioChannels;
    outChannels = MANUAL[channels];
    reasons.push('manual');
  } else if (!device) {
    channels = 'auto-safe';
    outChannels = null;
  } else if (!passthrough && (STEREO_FORMS.has(device.form) || (device.channels > 0 && device.channels <= 2))) {
    channels = 'stereo';
    outChannels = 2;
    reasons.push(STEREO_FORMS.has(device.form) ? 'stereo-device' : 'stereo-mixer');
  } else {
    channels = 'auto-safe';
    outChannels = device.channels > 0 ? device.channels : null;
  }
  if (passthrough && !MANUAL[p.audioChannels]) outChannels = null;
  return { channels, passthrough, exclusive: passthrough && !!p.audioExclusive, device, outChannels, reasons };
}

module.exports = { FORM, DIGITAL_FORMS, STEREO_FORMS, SCRIPT, parseProbeOutput, probeAudioEndpoints, AudioOutputProbe, endpointIdFromSetting, pickDevice, resolveAudioOutput };
