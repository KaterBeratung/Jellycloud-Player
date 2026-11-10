'use strict';

const { BaseWindow, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { MpvPlayer } = require('./mpv');
const { MpvZOrder } = require('./zorder');
const { buildMpvArgs, findMpv, probeMpv, listAudioDevices } = require('./mpv-args');
const { buildDeviceProfile, resolvePlayback, mpvTrackId, streamIndexFromMpvId, describeMedia, pickStreams } = require('./profile');
const { secondsToTicks, ticksToSeconds } = require('./jellyfin');
const { resolveAudioOutput } = require('./audio-output');
const { buildPauseInfo } = require('./pause-info');
const { buildEpisodeList, nextEpisode } = require('./episode-list');
const { coverBounds } = require('./fullscreen-bounds');

class PlayerError extends Error {
  constructor(message, code = 'PLAYER_ERROR') {
    super(message);
    this.code = code;
  }
}

/** Der Start wurde durch Schliessen (oder einen neuen Start) abgebrochen; kein Fehler fuer den Nutzer. */
class Cancelled extends Error {}

const FLUSH_MS = 150;
const POS_PUSH_MS = 500; // mpv meldet die Zeit bei jedem Bild; die Steuerung rechnet dazwischen selbst weiter
const STOP_WAIT_MS = 1500; // so lange hoechstens wartet die Oberflaeche auf die Stopped-Meldung, bevor sie ihre Listen neu laedt
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHANNEL_MODES = { auto: null, stereo: 'stereo', '5.1': '5.1', '7.1': '7.1' };

/**
 * Verwaltet Wiedergabe: mpv-Prozess, Fenster (Host + Overlay), Fortschrittsmeldungen an Jellyfin,
 * Intro-Ueberspringen, Autoplay der naechsten Folge.
 *
 * Grundregel: Die Bedienung (Schliessen, Spurwechsel) wartet nie auf den Server. Meldungen laufen im Hintergrund,
 * und jeder laufende Start prueft nach jedem Schritt, ob er noch gebraucht wird (`_session`).
 */
class PlayerController extends EventEmitter {
  /**
   * @param {{getClient:()=>import('./jellyfin').JellyfinClient|null, getSettings:()=>any, saveSettings:(patch:any)=>void, paths:{preload:string, playerHtml:string, icon?:string, resources:string, appRoot:string}, fake?:{exe:string, prefix:string[], env:object}|null, audioProbe?:import('./audio-output').AudioOutputProbe|null}} o
   */
  constructor({ getClient, getSettings, saveSettings, getUi = null, getHostWindow = null, paths, fake = null, audioProbe = null, getLimits = null, refreshLimits = null }) {
    super();
    this.getLimits = getLimits; // zuletzt bekannte Bitratengrenze des Servers (nur Internet), siehe JellyfinClient.getStreamingLimits
    this.refreshLimits = refreshLimits;
    this.getUi = getUi;
    this.getHostWindow = getHostWindow;
    this.getClient = getClient;
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.paths = paths;
    this.fake = fake;
    this.audioProbe = audioProbe;
    this.mpv = null;
    this.host = null;
    this.overlay = null;
    this.cur = null;
    this.audio = null;
    this.state = {};
    this.pending = {};
    this.flushTimer = null;
    this.reportTimer = null;
    this.busy = false;
    this.stopping = false;
    this._session = 0;
    this.quality = undefined; // Qualitaet dieser Wiedergabe in Mbit/s (0 = Original); undefined = Einstellung "Qualitaetsgrenze"
    this._stopPromise = null;
    this._reports = new Set();
    this._pushedPos = { at: 0, value: 0 };
    this.episodeCache = new Map();
    this._volTimer = null;
    ipcMain.on('player:cmd', (e, cmd) => {
      if (this.overlay && !this.overlay.isDestroyed() && e.sender === this.overlay.webContents) this._onCommand(cmd);
    });
    ipcMain.handle('player:get-state', (e) => (this.overlay && e.sender === this.overlay.webContents ? this.state : null));
  }

  get active() {
    return !!this.mpv && !this.stopping;
  }

  hasPendingReports() {
    return this._reports.size > 0;
  }

  /**
   * Was gerade laeuft, fuer Discord Rich Presence (discord-presence.js): Eintrag, Position, Laenge, Pause, Tempo. null, solange nichts laeuft (laedt, Fehler, beendet).
   * Aenderungen kommen als Ereignis "nowplaying" (Start, Pause, Tempo, Sprung, Ende); die Position selbst fragt der Empfaenger bei Bedarf ab.
   */
  nowPlaying() {
    const c = this.cur;
    const s = this.state;
    if (!c || !this.mpv || this.stopping || s.phase !== 'playing') return null;
    const duration = Number(s.duration) > 0 ? Number(s.duration) : ticksToSeconds(c.item.RunTimeTicks) || 0;
    return { item: c.item, position: Number(s.position) || 0, duration, paused: !!s.paused, speed: Number(s.speed) || 1 };
  }

  detectMpv() {
    if (this.fake) return { ok: true, exe: this.fake.exe, version: [0, 40, 0], versionText: 'fake', firstLine: 'fake mpv' };
    if (this._mpvProbe) return this._mpvProbe;
    // mpv ist fest eingebaut: nur das mitgelieferte mpv wird verwendet.
    const exe = findMpv({ resourcesPath: this.paths.resources, appRoot: this.paths.appRoot });
    const probe = exe ? probeMpv(exe) : { ok: false, error: 'Das mitgelieferte mpv fehlt (Installation beschädigt).' };
    if (probe.ok) this._mpvProbe = probe;
    return probe;
  }

  /** Audio-Ausgabegeraete laut mpv (einmal ermittelt und gemerkt). */
  audioDevices() {
    if (this.fake) return [{ id: 'auto', name: 'Automatisch' }];
    if (!this._devices) {
      const probe = this.detectMpv();
      this._devices = probe.ok ? listAudioDevices(probe.exe) : [];
    }
    return this._devices;
  }

  // ---------- Ton-Ausgabe ----------

  _decideAudio() {
    const endpoints = this.audioProbe?.ensureFresh() ?? null;
    return resolveAudioOutput({ player: this.getSettings().player, endpoints });
  }

  /** Erkanntes Ausgabegeraet und daraus gewaehlte Kanaele, fuer Einstellungen und Detailseite (ohne interne IDs). */
  audioOutput() {
    const d = this._decideAudio();
    const p = this.getSettings().player;
    return {
      channels: d.channels,
      outChannels: d.outChannels,
      passthrough: d.passthrough,
      passthroughBlocked: d.reasons.includes('passthrough-needs-digital'),
      requestedChannels: p.audioChannels,
      reasons: d.reasons,
      device: d.device ? { name: d.device.name, channels: d.device.channels, form: d.device.form } : null
    };
  }

  /** Gewaehlte Bitratengrenze in Mbit/s (0 = keine): die Wahl im Player gilt vor der Einstellung. */
  _qualityMbps() {
    if (this.quality !== undefined) return this.quality;
    const mbps = Number(this.getSettings().player.maxBitrateMbps);
    return mbps > 0 ? mbps : 0;
  }

  /** Die Bitratengrenze des Servers: die laufende Abfrage kurz abwarten, sonst der letzte bekannte Stand. */
  async _limitsNow() {
    const p = this._limitsP;
    if (p) {
      const fresh = await Promise.race([p.catch(() => null), sleep(1200).then(() => null)]);
      if (fresh) return fresh;
    }
    return this.getLimits?.() ?? null;
  }

  async _awaitAudioProbe() {
    const probe = this.audioProbe;
    if (!probe || probe.get()) return;
    await Promise.race([probe.refresh(), sleep(1500)]);
  }

  // ---------- Start ----------

  /**
   * Startet die Wiedergabe. Netzwerk (Eintrag, PlaybackInfo) und der Start von mpv samt Fenstern laufen gleichzeitig.
   * @returns {Promise<boolean>} false, wenn der Start abgebrochen wurde (Schliessen waehrend des Ladens)
   */
  async play(req) {
    // Wer gleich nach "Zurueck" etwas Neues startet, wartet kurz auf das Ende des Schliessens (mpv beenden), statt abgewiesen zu werden.
    if (this._stopPromise) await this._stopPromise;
    if (this.busy) throw new PlayerError('Die Wiedergabe startet bereits', 'BUSY');
    this.busy = true;
    const sid = ++this._session;
    try {
      const client = this.getClient();
      if (!client) throw new PlayerError('Nicht angemeldet', 'NOT_LOGGED_IN');
      await this._awaitAudioProbe();
      this._ensure(sid);
      this.audio = this._decideAudio();
      // Bitratengrenze des Servers parallel erfragen (im lokalen Netz nur eine winzige Anfrage, siehe getStreamingLimits)
      this._limitsP = this.refreshLimits?.() ?? null;
      this._limitsP?.catch(() => {});
      const prepared = this._prepare(req);
      prepared.catch(() => {}); // Fehler erst unten auswerten, nicht als "unbehandelt" melden
      if (!this.mpv) await this._openMpv(sid);
      this._ensure(sid);
      await this._startItem(await prepared, sid);
      return true;
    } catch (e) {
      if (e instanceof Cancelled || this._session !== sid) return false;
      await this._teardown();
      throw e;
    } finally {
      if (this._session === sid) this.busy = false;
    }
  }

  _ensure(sid) {
    if (sid !== this._session) throw new Cancelled();
  }

  /**
   * Nur Netzwerk, ohne mpv und ohne den Zustand zu aendern: Eintrag holen, Spuren waehlen, PlaybackInfo anfragen.
   * Die Spuren werden schon fuer die Anfrage gewaehlt: Bei einem Transcode steckt nur die angeforderte Tonspur im Strom.
   */
  async _prepare(req, { noRewind = false } = {}) {
    const client = this.getClient();
    const ps = this.getSettings().player;
    const item = await client.getItem(req.itemId);
    const startTicks = req.startTicks ?? (req.resume !== false ? item.UserData?.PlaybackPositionTicks ?? 0 : 0);
    const mbps = this._qualityMbps();
    const maxBitrate = mbps > 0 ? Math.round(mbps * 1_000_000) : undefined;
    const lang = this.getUi?.().language?.slice(0, 2);
    const src0 = item.MediaSources?.find((s) => s.Id === req.mediaSourceId) ?? item.MediaSources?.[0];
    const pre = src0 ? pickStreams(src0, ps, lang, this.audio?.outChannels) : {};
    const audioIndex = req.audioIndex ?? pre.audioIndex ?? undefined;
    const subtitleIndex = req.subtitleIndex ?? pre.subtitleIndex ?? undefined;
    const forceTranscode = !!req.forceTranscode;
    const info = await client.getPlaybackInfo(item.Id, {
      deviceProfile: buildDeviceProfile({ maxBitrateMbps: mbps, maxAudioChannels: this.audio?.outChannels === 2 ? 2 : 8 }),
      startTicks,
      maxBitrate,
      mediaSourceId: req.mediaSourceId,
      audioIndex,
      subtitleIndex,
      enableTranscoding: ps.allowTranscode !== false,
      forceTranscode
    });
    const res = resolvePlayback({ info, base: client.baseUrl, itemId: item.Id, mediaSourceId: req.mediaSourceId, deviceId: client.deviceId, forceTranscode });
    return { item, startTicks, res, audioIndex, subtitleIndex, reqAudio: req.audioIndex, reqSub: req.subtitleIndex, noRewind, forced: forceTranscode };
  }

  async _openMpv(sid) {
    const settings = this.getSettings();
    const probe = this.detectMpv();
    if (!probe.ok) throw new PlayerError('Das in die App eingebaute mpv fehlt. Bitte Jellycloud Player neu installieren.', 'MPV_NOT_FOUND');
    await this._createWindows();
    this._ensure(sid);
    const buf = this.host.getNativeWindowHandle();
    const wid = (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString();
    const pipe = `\\\\.\\pipe\\jellycloud-${process.pid}-${Date.now()}`;
    const audio = this.audio ?? this._decideAudio();
    const args = buildMpvArgs({ player: settings.player, audio, pipe, wid, version: probe.version });
    const mpv = new MpvPlayer({
      exe: probe.exe,
      args,
      pipe,
      spawnPrefix: this.fake?.prefix ?? [],
      env: this.fake?.env ?? process.env
    });
    this.mpv = mpv;
    this.mpvInfo = { exe: probe.exe, version: probe.versionText, embedded: true };
    this._channelsMode = settings.player.audioChannels in CHANNEL_MODES ? settings.player.audioChannels : 'auto';
    // Ereignisse eines laengst beendeten mpv duerfen den Zustand einer neuen Sitzung nicht veraendern.
    const live = (fn) => (...a) => this.mpv === mpv && fn(...a);
    mpv.on('property', live((n, v) => this._onProperty(n, v)));
    mpv.on('file-loaded', live(() => this._onFileLoaded()));
    mpv.on('end-file', live((e) => this._onEndFile(e)));
    mpv.on('exit', (e) => {
      if (this.mpv === mpv && !this.stopping) {
        this.mpv = null;
        this._push({ phase: 'error', error: `mpv wurde unerwartet beendet${e.stderr ? `: ${e.stderr.trim().split(/\r?\n/).pop()}` : ''}` });
        if (!this.overlay) this.stop();
      }
    });
    await mpv.start();
    this._ensure(sid);
    // mpv-Fenster ueber Chromiums Hilfsfenster halten (sonst bleibt das Video schwarz); der Simulator hat kein Fenster.
    if (!this.fake && process.platform === 'win32') this.zorder = new MpvZOrder(wid).start();
    if (settings.player.preventSleep && this._sleepId == null) this._sleepId = powerSaveBlocker.start('prevent-display-sleep');
    const vol = Number(settings.player.volume ?? 100);
    await Promise.all([mpv.setProperty('volume', vol), settings.player.muted ? mpv.setProperty('mute', true) : null]);
    this._ensure(sid);
    // Nicht ueberschreiben: mpv liefert die Startwerte der beobachteten Eigenschaften bereits beim Registrieren.
    this._push({
      phase: 'loading',
      volume: vol,
      mute: !!settings.player.muted,
      mpv: this.mpvInfo,
      ui: this.getUi?.() ?? {},
      audioCfg: this._audioCfg(audio)
    });
  }

  _audioCfg(d = this.audio) {
    return {
      mode: this._channelsMode ?? 'auto',
      device: d?.device?.name ?? null,
      deviceChannels: d?.device?.channels ?? null,
      passthrough: !!d?.passthrough,
      passthroughBlocked: !!d?.reasons?.includes('passthrough-needs-digital')
    };
  }

  /**
   * Bereitet die Fenster fuer die eingebettete Wiedergabe vor. Bevorzugt dient das Hauptfenster selbst als Host:
   * mpv fuellt dessen Flaeche, die Steuerung liegt als randloses, durchsichtiges Fenster darueber. Es oeffnet sich also
   * kein zusaetzliches Fenster (keine zweite Taskleisten-Schaltflaeche). Gibt es kein Hauptfenster, entsteht ein eigener Host.
   * Chromiums Hilfsfenster liegen ueber mpv; MpvZOrder holt das mpv-Fenster deshalb nach oben.
   */
  _createWindows() {
    const { preload, playerHtml, icon } = this.paths;
    let host = this.getHostWindow?.() ?? null;
    if (host && host.isDestroyed()) host = null;
    this.ownsHost = !host;
    if (!host) {
      host = new BaseWindow({ width: 1280, height: 720, minWidth: 640, minHeight: 360, backgroundColor: '#000000', title: 'Jellycloud Player', icon, show: false });
      host.removeMenu();
    }
    this.hostWasFullScreen = host.isFullScreen();
    const overlay = new BrowserWindow({
      parent: host,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    overlay.setMenu(null);
    overlay.loadFile(playerHtml);

    const sync = () => {
      if (overlay.isDestroyed() || host.isDestroyed() || host.isMinimized()) return;
      // Im Vollbild ragt das Overlay ringsum etwas ueber den Bildschirm hinaus (siehe fullscreen-bounds.js): sonst bleibt bei gebrochener Skalierung ein Streifen der Taskleiste unten stehen
      const b = host.getContentBounds();
      overlay.setBounds(host.isFullScreen() ? coverBounds(b) : b);
      this.zorder?.raise();
    };
    const syncSoon = () => {
      sync();
      setTimeout(sync, 80);
      setTimeout(sync, 300);
    };
    const listeners = [];
    const on = (ev, fn) => {
      host.on(ev, fn);
      listeners.push([ev, fn]);
    };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'restore', 'show']) on(ev, sync);
    for (const ev of ['enter-full-screen', 'leave-full-screen']) on(ev, syncSoon);
    on('enter-full-screen', () => this._push({ fullscreen: true }));
    on('leave-full-screen', () => this._push({ fullscreen: false }));
    on('focus', () => !overlay.isDestroyed() && overlay.focus());
    // Beim Minimieren pausieren (und beim Wiederherstellen fortsetzen), wenn eingestellt
    on('minimize', () => {
      if (this.getSettings().player.pauseOnMinimize && this.mpv && !this.state.paused) {
        this._pausedByMinimize = true;
        this.mpv.setProperty('pause', true).catch(() => {});
      }
    });
    on('restore', () => {
      if (this._pausedByMinimize) {
        this._pausedByMinimize = false;
        this.mpv?.setProperty('pause', false).catch(() => {});
      }
    });
    if (this.ownsHost) {
      on('close', (e) => {
        if (!this.stopping) {
          e.preventDefault();
          this.stop();
        }
      });
    }
    this._offHost = () => {
      if (host.isDestroyed()) return;
      for (const [ev, fn] of listeners) host.off(ev, fn);
    };
    const shown = new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (host.isDestroyed() || overlay.isDestroyed()) return resolve();
        if (this.ownsHost) host.show();
        sync();
        overlay.showInactive();
        overlay.focus();
        resolve();
      };
      overlay.once('ready-to-show', done);
      setTimeout(done, 6000).unref?.();
    });
    overlay.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        e.preventDefault();
        host.setFullScreen(!host.isFullScreen());
      }
    });
    this.host = host;
    this.overlay = overlay;
    this._syncWindows = syncSoon;
    this._push({ fullscreen: host.isFullScreen(), ownsHost: this.ownsHost });
    this.emit('active', true);
    return shown;
  }

  // ---------- Laden eines Eintrags ----------

  /** Folgewechsel innerhalb einer laufenden Sitzung (naechste Folge): alter Eintrag wird im Hintergrund gemeldet. */
  async _switchItem(req, { atEnd = false } = {}) {
    const sid = this._session;
    this._sendStopReport(this._takeStopReport(atEnd));
    this._push({ phase: 'loading', error: null, position: 0, duration: 0 });
    const prepared = await this._prepare(req);
    this._ensure(sid);
    await this._startItem(prepared, sid);
  }

  /**
   * Laedt denselben Eintrag neu an der aktuellen Position, z. B. nach einem Spurwechsel im Transcode (die Spur steckt dann
   * im Strom, der Server muss neu codieren) oder als Rueckfall auf Transcode, wenn Direct Play nicht abspielbar war.
   */
  async _reload(over = {}) {
    const c = this.cur;
    if (!c || this.busy || this.stopping) return;
    this.busy = true;
    const sid = this._session;
    try {
      const pos = Math.max(0, this.state.position ?? c.startSec ?? 0);
      const req = { itemId: c.item.Id, mediaSourceId: c.res.mediaSourceId, startTicks: secondsToTicks(pos), resume: false, ...over };
      if (req.audioIndex === undefined && c.audioIdx != null) req.audioIndex = c.audioIdx;
      if (req.subtitleIndex === undefined && c.subIdx != null) req.subtitleIndex = c.subIdx;
      this._push({ phase: 'loading', error: null });
      const prepared = await this._prepare(req, { noRewind: true });
      this._ensure(sid);
      this._sendStopReport(this._takeStopReport(false));
      await this._startItem(prepared, sid);
    } catch (e) {
      if (e instanceof Cancelled || this._session !== sid) return;
      this._push({ phase: 'error', error: e.message });
    } finally {
      if (this._session === sid) this.busy = false;
    }
  }

  async _startItem(prepared, sid) {
    this._ensure(sid);
    const mpv = this.mpv;
    if (!mpv) throw new Cancelled();
    const client = this.getClient();
    const ps = this.getSettings().player;
    const { item, startTicks, res } = prepared;
    const streams = res.source.MediaStreams ?? [];
    // Spuren: ausdruecklich gewaehlte zuerst, sonst nach den Sprach-Einstellungen (gleiche Logik wie die Detailseite), sonst Server-Vorgabe.
    const picked = pickStreams(res.source, ps, this.getUi?.().language?.slice(0, 2), this.audio?.outChannels);
    // Bei einem Transcode zaehlt, was beim Server angefragt wurde: nur diese Tonspur steckt im Strom.
    const audioIdx = prepared.reqAudio ?? (res.isTranscode ? prepared.audioIndex : picked.audioIndex) ?? res.defaultAudioIndex;
    const subIdx = prepared.reqSub ?? (res.isTranscode ? prepared.subtitleIndex : picked.subtitleIndex) ?? res.defaultSubtitleIndex;
    const subStream = streams.find((s) => s.Type === 'Subtitle' && s.Index === subIdx);
    const useIds = !res.isTranscode;
    const aid = useIds ? mpvTrackId(streams, 'Audio', audioIdx) : null;
    const sid2 = useIds && subStream && !subStream.IsExternal ? mpvTrackId(streams, 'Subtitle', subIdx) : null;
    // Direct Play: nur Dateien neben dem Video kommen per URL. Transcode: der Server liefert den gewaehlten Textuntertitel als eigene Datei.
    const externalSelect = useIds ? (subStream?.IsExternal ? subIdx : null) : subStream?.DeliveryMethod === 'External' ? subIdx : null;
    const externalSubs = res.isTranscode ? res.externalSubtitles.filter((s) => s.index === subIdx) : res.externalSubtitles;

    // Begrenzt der Server die Bitrate (nur ueber das Internet) und liegt die Datei darueber, ist Direct Play dort nicht moeglich:
    // das Original laesst sich vom Client nicht erzwingen. Der Grund steht in der Technik-Info und im Qualitaets-Menue, nicht als Einblendung.
    const lim = await this._limitsNow();
    this._ensure(sid); // waehrend des Wartens koennte geschlossen worden sein
    const limitBps = lim?.remote === true ? lim.limitBps : 0;
    const serverLimit = limitBps > 0 ? { mbps: +(limitBps / 1e6).toFixed(1), exceeded: res.isTranscode && Number(res.source.Bitrate) > limitBps } : null;

    const rewind = startTicks > 0 && !prepared.noRewind ? ps.resumeRewindSec ?? 0 : 0;
    const startSec = Math.max(0, ticksToSeconds(startTicks) - rewind);
    const media = describeMedia(res.source);
    const isEpisode = item.Type === 'Episode';
    const title = isEpisode ? item.SeriesName ?? item.Name : item.Name;
    const subtitle = isEpisode
      ? `${item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}:` : ''}E${item.IndexNumber ?? '?'} · ${item.Name}`
      : [item.ProductionYear, item.OfficialRating].filter(Boolean).join(' · ');

    this.cur = {
      item,
      res,
      streams,
      media,
      startSec,
      selectExternal: externalSelect,
      segments: [],
      skipped: new Set(),
      next: null,
      lastSent: 0,
      ended: false,
      started: false,
      retried: !!prepared.forced,
      audioIdx,
      subIdx
    };
    this.state.position = startSec;
    this._pushedPos = { at: 0, value: startSec };
    this._push({
      phase: 'loading',
      itemId: item.Id,
      title,
      subtitle,
      isEpisode,
      pauseInfo: buildPauseInfo(item, { spoilerProtection: !!this.getSettings().general?.spoilerProtection }), // Pausenbildschirm: Logo, Beschreibung, Folge ...
      method: res.method,
      media,
      segments: [],
      next: null,
      episodes: null, // kommt mit der naechsten Folge (siehe unten); bis dahin zeigt der Player den Knopf "Folgen" nicht
      trickplay: this._trickplayFor(item, res.mediaSourceId),
      jfChapters: (item.Chapters ?? []).map((c) => ({ title: c.Name, time: ticksToSeconds(c.StartPositionTicks) })),
      posterTag: item.ImageTags?.Primary ?? null,
      position: startSec,
      serverLimit, // nur zum Nachsehen (Technik-Info, Qualitaets-Menue): beim Abspielen wird nichts eingeblendet
      // Qualitaetswahl im Player: aktuelle Grenze, ob Transcoding erlaubt ist, Bitrate der Quelle (nur kleinere Stufen anbieten)
      quality: { mbps: this._qualityMbps(), allowed: ps.allowTranscode !== false, sourceMbps: media.bitrate ? media.bitrate / 1e6 : null },
      // Im Transcode kennt mpv nur die eine Spur im Strom; die Liste kommt dann vom Server (Wechsel = neu laden).
      ...(res.isTranscode ? { tracks: this._transcodeTracks(this.cur) } : {})
    });

    // Segmente und naechste Folge parallel laden, blockiert den Start nicht.
    const itemId = item.Id;
    client.getMediaSegments(itemId).then((segs) => {
      if (this.cur?.item.Id !== itemId) return;
      const ps2 = this.getSettings().player;
      this.cur.segments = segs
        .map((s) => ({ type: s.Type, start: ticksToSeconds(s.StartTicks), end: ticksToSeconds(s.EndTicks) }))
        .filter((s) => s.end > s.start)
        // Je Art abschaltbar: Intro/Rueckblick/Vorschau folgen "Intro ueberspringen", der Abspann "Abspann ueberspringen".
        .filter((s) => (s.type === 'Outro' ? ps2.skipOutro !== 'off' : ps2.skipIntro !== 'off'));
      this._push({ segments: this.cur.segments });
    });
    if (isEpisode && item.SeriesId) {
      this._loadEpisodes(item).then(({ next, list }) => {
        if (this.cur?.item.Id !== itemId) return;
        this.cur.next = next;
        this.cur.episodeIds = new Set(list.map((e) => e.id));
        this._push({ next: next ? { id: next.Id, title: next.Name, label: `E${next.IndexNumber ?? '?'}` } : null, episodes: list });
      });
    }

    await mpv.load({
      url: res.url,
      headers: client.mpvHeaders(),
      start: startSec,
      aid,
      sid: sid2,
      externalSubs,
      title: `${title} ${subtitle}`.trim()
    });
    this._ensure(sid);
  }

  /**
   * Folgen der Serie: die naechste Folge (fuer "Naechste Folge" und den Countdown) und die Liste fuer den Knopf "Folgen" im Player.
   * Immer frisch vom Server, damit die Haken und Fortschrittsbalken stimmen (eine eben gesehene Folge soll nicht mehr als ungesehen erscheinen);
   * bei einem Fehler gilt die zuletzt geholte Liste, ohne Liste gibt es weder naechste Folge noch Knopf.
   */
  async _loadEpisodes(item) {
    const client = this.getClient();
    let eps = this.episodeCache.get(item.SeriesId) ?? null;
    try {
      eps = await client.getEpisodes(item.SeriesId);
      this.episodeCache.set(item.SeriesId, eps);
    } catch {
      /* alte Liste (falls vorhanden) behalten */
    }
    if (!eps) return { next: null, list: [] };
    return { next: nextEpisode(eps, item.Id), list: buildEpisodeList(eps, { spoilerProtection: !!this.getSettings().general?.spoilerProtection }) };
  }

  _trickplayFor(item, mediaSourceId) {
    const all = item.Trickplay?.[mediaSourceId] ?? Object.values(item.Trickplay ?? {})[0];
    if (!all) return null;
    const widths = Object.keys(all).map(Number).sort((a, b) => a - b);
    const w = widths.find((x) => x >= 240) ?? widths[widths.length - 1];
    const t = all[w];
    if (!t) return null;
    return { itemId: item.Id, mediaSourceId, width: t.Width, height: t.Height, tileWidth: t.TileWidth, tileHeight: t.TileHeight, interval: t.Interval, count: t.ThumbnailCount, sheetWidth: w };
  }

  // ---------- mpv-Ereignisse ----------

  async _onFileLoaded() {
    const c = this.cur;
    if (!c) return;
    c.started = true;
    await this.mpv?.attachExternalSubs(c.selectExternal).catch(() => {});
    if (this.cur !== c) return;
    this._push({ phase: 'playing' });
    if (this.getSettings().player.fullscreenOnPlay && this.host && !this.host.isDestroyed() && !this.host.isFullScreen()) this.host.setFullScreen(true);
    const client = this.getClient();
    client.reportStart(this._payload({ PositionTicks: secondsToTicks(c.startSec) }));
    clearInterval(this.reportTimer);
    this.reportTimer = setInterval(() => this._report('TimeUpdate'), 10000);
    this._watchAudio(c);
  }

  _onEndFile({ reason, error }) {
    if (reason !== 'error') return;
    const c = this.cur;
    const ps = this.getSettings().player;
    // Direct Play ging nicht (Format, Netz, Server): einmal automatisch auf Transcode ausweichen, solange das erlaubt ist.
    if (c && !c.res.isTranscode && !c.retried && ps.allowTranscode !== false && !this.busy && !this.stopping) {
      c.retried = true;
      this._push({ notice: { kind: 'transcodeFallback', at: Date.now() } });
      this._reload({ forceTranscode: true });
      return;
    }
    this._push({ phase: 'error', error: `Datei konnte nicht geöffnet werden${error ? ` (${error})` : ''}` });
  }

  _onProperty(name, value) {
    const s = this.state;
    switch (name) {
      case 'time-pos':
        if (typeof value === 'number') {
          s.position = value;
          // mpv meldet die Zeit bei jedem Bild. Weitergegeben wird sie nur etwa zweimal pro Sekunde (oder sofort bei einem Sprung).
          const now = Date.now();
          const last = this._pushedPos;
          const expected = last.value + ((now - last.at) / 1000) * (s.speed ?? 1);
          if (now - last.at >= POS_PUSH_MS || Math.abs(value - expected) > 1.2 || s.paused) {
            const jumped = Math.abs(value - expected) > 1.2;
            this._pushedPos = { at: now, value };
            this._push({ position: value });
            this._tick(value);
            if (jumped && !s.paused && this.cur?.started) this.emit('nowplaying'); // Sprung (oder Stocken): der Fortschritt in Discord muss nachziehen
          }
        }
        break;
      case 'duration':
        if (typeof value === 'number') this._push({ duration: value });
        break;
      case 'pause':
        this._push({ paused: !!value });
        if (this.cur?.started) this._report(value ? 'Pause' : 'Unpause');
        break;
      case 'volume':
        this._push({ volume: value });
        this._persistVolume();
        break;
      case 'mute':
        this._push({ mute: !!value });
        this._persistVolume();
        break;
      case 'speed':
        this._push({ speed: value });
        break;
      case 'eof-reached':
        if (value === true) this._onEof();
        break;
      case 'core-idle':
      case 'paused-for-cache':
        this.mpvBuf = { ...(this.mpvBuf ?? {}), [name]: !!value };
        this._push({ buffering: !!this.mpvBuf['paused-for-cache'] });
        break;
      case 'track-list':
        this._push({ tracks: this._buildTracks(value ?? []) });
        break;
      case 'chapter-list':
        this._push({ chapters: (value ?? []).map((c) => ({ title: c.title, time: c.time })) });
        break;
      case 'video-params': {
        const v = value ?? {};
        this._push({
          video: {
            w: v.w,
            h: v.h,
            pixelformat: v.pixelformat,
            colormatrix: v.colormatrix,
            gamma: v.gamma,
            primaries: v.primaries,
            sigPeak: v['sig-peak'],
            hdr: v.gamma === 'pq' ? 'PQ (HDR10 / Dolby Vision)' : v.gamma === 'hlg' ? 'HLG' : 'SDR'
          }
        });
        break;
      }
      case 'current-ao':
      case 'audio-out-params':
        this._push({ audioOut: this._audioOutInfo() });
        break;
      case 'hwdec-current':
      case 'current-vo':
      case 'audio-codec-name':
      case 'video-codec':
      case 'container-fps':
      case 'file-format':
      case 'video-bitrate':
      case 'audio-bitrate':
      case 'frame-drop-count':
      case 'decoder-frame-drop-count':
      case 'estimated-vf-fps':
      case 'demuxer-cache-time':
        this._push({ stats: { ...(this.state.stats ?? {}), [name]: value } });
        break;
      case 'sub-delay':
        this._push({ subDelay: value });
        break;
      case 'audio-delay':
        this._push({ audioDelay: value });
        break;
      case 'sub-scale':
        this._push({ subScale: value });
        break;
      default:
        break;
    }
  }

  /** Was mpv tatsaechlich an die Tonausgabe liefert (Kanaele, Format); null = (noch) keine Ausgabe. */
  _audioOutInfo() {
    const m = this.mpv;
    const p = m?.prop('audio-out-params');
    if (!p) return { active: false, ao: m?.prop('current-ao') ?? null };
    return {
      active: true,
      ao: m.prop('current-ao') ?? null,
      format: p.format ?? null,
      rate: p.samplerate ?? null,
      channels: p['channel-count'] ?? null,
      layout: p['hr-channels'] ?? p.channels ?? null,
      spdif: /^spdif/i.test(String(p.format ?? ''))
    };
  }

  _buildTracks(list) {
    const c = this.cur;
    if (c?.res.isTranscode) return this._transcodeTracks(c);
    const audioJ = (c?.streams ?? []).filter((s) => s.Type === 'Audio' && !s.IsExternal).sort((a, b) => a.Index - b.Index);
    const subJ = (c?.streams ?? []).filter((s) => s.Type === 'Subtitle' && !s.IsExternal).sort((a, b) => a.Index - b.Index);
    let ai = 0;
    let si = 0;
    const audio = [];
    const sub = [];
    for (const t of list) {
      if (t.type === 'audio') {
        const j = c ? audioJ[ai] : null;
        ai++;
        audio.push({ id: t.id, label: j?.DisplayTitle || t.title || t.lang || `Spur ${t.id}`, lang: t.lang || j?.Language || '', codec: t.codec, channels: t['demux-channel-count'] ?? j?.Channels, selected: !!t.selected, default: !!t.default });
      } else if (t.type === 'sub') {
        const j = !t.external && c ? subJ[si] : null;
        if (!t.external) si++;
        sub.push({ id: t.id, label: j?.DisplayTitle || t.title || t.lang || `Untertitel ${t.id}`, lang: t.lang || j?.Language || '', codec: t.codec, forced: !!(t.forced || j?.IsForced), external: !!t.external, selected: !!t.selected, default: !!t.default });
      }
    }
    return { audio, sub };
  }

  /** Spurliste im Transcode: alle Spuren des Eintrags laut Server. Die ID ist der Jellyfin-Stream-Index. */
  _transcodeTracks(c) {
    const streams = c?.streams ?? [];
    const mk = (s, fallback) => ({
      id: s.Index,
      label: s.DisplayTitle || s.Title || s.Language || `${fallback} ${s.Index}`,
      lang: s.Language || '',
      codec: s.Codec,
      channels: s.Channels,
      forced: !!s.IsForced,
      external: !!s.IsExternal,
      default: !!s.IsDefault
    });
    return {
      audio: streams.filter((s) => s.Type === 'Audio').map((s) => ({ ...mk(s, 'Spur'), selected: s.Index === c.audioIdx })),
      sub: streams.filter((s) => s.Type === 'Subtitle').map((s) => ({ ...mk(s, 'Untertitel'), selected: s.Index === c.subIdx }))
    };
  }

  _tick(pos) {
    const c = this.cur;
    if (!c || !c.started) return;
    const settings = this.getSettings();
    // Intro/Rueckblick bzw. Abspann automatisch ueberspringen
    for (const seg of c.segments) {
      const auto = seg.type === 'Outro' ? settings.player.skipOutro === 'auto' : settings.player.skipIntro === 'auto' && (seg.type === 'Intro' || seg.type === 'Recap');
      if (auto && pos >= seg.start && pos < seg.end - 1 && !c.skipped.has(seg.start)) {
        c.skipped.add(seg.start);
        this.mpv?.command('seek', seg.end, 'absolute').catch(() => {});
      }
    }
  }

  _persistVolume(now = false) {
    clearTimeout(this._volTimer);
    this._volTimer = null;
    const save = () => {
      this._volTimer = null;
      const { volume, mute } = this.state;
      if (typeof volume === 'number') this.saveSettings({ player: { volume: Math.round(volume), muted: !!mute } });
    };
    if (now) save();
    else this._volTimer = setTimeout(save, 800);
  }

  async _onEof() {
    const c = this.cur;
    if (!c || c.ended || this.stopping) return;
    c.ended = true;
    const settings = this.getSettings();
    if (settings.player.autoplayNext && c.next && !this.busy) {
      this.busy = true;
      const sid = this._session;
      try {
        await this._switchItem({ itemId: c.next.Id, resume: false }, { atEnd: true });
      } catch (e) {
        if (!(e instanceof Cancelled) && this._session === sid) this._push({ phase: 'error', error: e.message });
      } finally {
        if (this._session === sid) this.busy = false;
      }
    } else {
      await this.stop(true);
    }
  }

  // ---------- Ton: Kontrolle und Rueckfall ----------

  /**
   * Prueft kurz nach dem Start, ob mpv die Tonausgabe wirklich geoeffnet hat. Fehlt sie trotz Tonspur und laufendem Bild
   * (Geraet lehnt Bitstream, exklusiven Modus oder die Kanalzahl ab), geht es mit der sichersten Einstellung weiter:
   * PCM-Stereo im gemeinsamen Modus. Lieber Stereo als Stille.
   */
  _watchAudio(c) {
    clearInterval(this._audioTimer);
    let ticks = 0;
    let silent = 0;
    this._audioTimer = setInterval(() => {
      const m = this.mpv;
      if (!m || this.cur !== c || ++ticks > 30) return clearInterval(this._audioTimer);
      if (!this.state.tracks?.audio?.length) return; // Datei ohne Ton
      if (m.prop('audio-out-params')) return clearInterval(this._audioTimer); // Ausgabe laeuft
      if (m.prop('pause') || m.prop('core-idle') !== false || m.prop('paused-for-cache')) return; // es laeuft (noch) nichts
      if (++silent < 3) return;
      clearInterval(this._audioTimer);
      this._audioFallback();
    }, 1000);
    this._audioTimer.unref?.();
  }

  async _audioFallback() {
    const m = this.mpv;
    if (!m || this._audioFellBack) return;
    this._audioFellBack = true;
    const ignore = () => {};
    await m.setProperty('audio-spdif', '').catch(ignore);
    await m.setProperty('audio-exclusive', 'no').catch(ignore);
    await m.setProperty('audio-channels', 'stereo').catch(ignore);
    await m.command('ao-reload').catch(ignore);
    this._channelsMode = 'stereo';
    this.audio = { ...(this.audio ?? {}), channels: 'stereo', passthrough: false, exclusive: false, outChannels: 2 };
    this._push({ notice: { kind: 'audioFallback', at: Date.now() }, audioCfg: this._audioCfg() });
  }

  /** Kanalmodus waehrend der Wiedergabe wechseln ('auto' = so, wie die Erkennung es waehlt). Gilt bis zum Ende der Sitzung. */
  async _setChannels(mode) {
    const m = this.mpv;
    if (!m || !(mode in CHANNEL_MODES)) return;
    let ch = CHANNEL_MODES[mode];
    if (ch === null) {
      const auto = resolveAudioOutput({ player: { ...this.getSettings().player, audioChannels: 'auto' }, endpoints: this.audioProbe?.get() ?? null });
      ch = auto.channels;
    }
    this._channelsMode = mode;
    const outChannels = { stereo: 2, '5.1': 6, '7.1': 8 }[ch] ?? this.audio?.outChannels ?? null;
    this.audio = { ...(this.audio ?? {}), channels: ch, outChannels };
    await m.setProperty('audio-channels', ch).catch(() => {});
    this._push({ audioCfg: this._audioCfg() });
  }

  // ---------- Meldungen an Jellyfin ----------

  _payload(extra = {}) {
    const c = this.cur;
    const s = this.state;
    return {
      ItemId: c.item.Id,
      MediaSourceId: c.res.mediaSourceId,
      PlaySessionId: c.res.playSessionId,
      PlayMethod: c.res.method,
      CanSeek: true,
      IsPaused: !!s.paused,
      IsMuted: !!s.mute,
      VolumeLevel: Math.round(s.volume ?? 100),
      PositionTicks: secondsToTicks(s.position ?? 0),
      AudioStreamIndex: c.audioIdx ?? undefined,
      SubtitleStreamIndex: c.subIdx ?? undefined,
      ...extra
    };
  }

  _report(eventName) {
    if (!this.cur?.started) return;
    this.getClient()?.reportProgress(this._payload({ EventName: eventName }));
  }

  /**
   * Haelt den aktuellen Eintrag als beendet fest (Position, Meldung) und raeumt `cur` sofort ab, ohne zu warten.
   * Die Meldung selbst verschickt `_sendStopReport` im Hintergrund.
   */
  _takeStopReport(atEnd = false) {
    const c = this.cur;
    if (!c) return null;
    clearInterval(this.reportTimer);
    this.reportTimer = null;
    clearInterval(this._audioTimer);
    const pos = atEnd ? this.state.duration || this.state.position : this.state.position;
    const ticks = secondsToTicks(pos ?? 0);
    this.lastStopped = { itemId: c.item.Id, seriesId: c.item.SeriesId ?? null, positionTicks: ticks };
    this.cur = null;
    const client = this.getClient();
    if (!c.started || !client) return null;
    return {
      client,
      payload: { ItemId: c.item.Id, MediaSourceId: c.res.mediaSourceId, PlaySessionId: c.res.playSessionId, PositionTicks: ticks },
      encoding: c.res.isTranscode ? c.res.playSessionId : null
    };
  }

  _sendStopReport(snap) {
    if (!snap) return Promise.resolve();
    const p = (async () => {
      await snap.client.reportStopped(snap.payload);
      if (snap.encoding) await snap.client.stopEncoding(snap.encoding);
    })()
      .catch(() => {})
      .finally(() => this._reports.delete(p));
    this._reports.add(p);
    return p;
  }

  /** Wartet (hoechstens `ms`) auf noch laufende Meldungen, z. B. vor dem Beenden der App. */
  async flushReports(ms = 3000) {
    if (!this._reports.size) return;
    await Promise.race([Promise.allSettled([...this._reports]), sleep(ms)]);
  }

  // ---------- Befehle des Overlays ----------

  _onCommand(cmd) {
    const m = this.mpv;
    if (!m || !cmd || typeof cmd.type !== 'string') {
      if (cmd?.type === 'close') this.stop();
      return;
    }
    const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
    const fail = () => {};
    const transcode = !!this.cur?.res.isTranscode;
    switch (cmd.type) {
      case 'pause':
        m.setProperty('pause', typeof cmd.value === 'boolean' ? cmd.value : !this.state.paused).catch(fail);
        break;
      case 'seek':
        if (cmd.to !== undefined) {
          clearTimeout(this._seekTimer);
          this._seekAcc = 0;
          m.command('seek', num(cmd.to, 0, 1e7), 'absolute').catch(fail);
        } else if (transcode) {
          // Jeder Sprung startet beim Server eine neue Codierung: schnelle Tastendruecke zu einem Sprung zusammenfassen.
          this._seekAcc = (this._seekAcc ?? 0) + num(cmd.by, -36000, 36000);
          clearTimeout(this._seekTimer);
          this._seekTimer = setTimeout(() => {
            const by = this._seekAcc;
            this._seekAcc = 0;
            if (by) this.mpv?.command('seek', by, 'relative').catch(fail);
          }, 300);
        } else {
          m.command('seek', num(cmd.by, -36000, 36000), 'relative').catch(fail);
        }
        break;
      case 'volume':
        m.setProperty('volume', num(cmd.value, 0, 130, 100)).catch(fail);
        break;
      case 'mute':
        m.setProperty('mute', typeof cmd.value === 'boolean' ? cmd.value : !this.state.mute).catch(fail);
        break;
      case 'speed':
        m.setProperty('speed', num(cmd.value, 0.25, 4, 1)).catch(fail);
        break;
      case 'audio':
        if (transcode) {
          if (Number.isInteger(cmd.id)) this._reload({ audioIndex: cmd.id });
          break;
        }
        m.setProperty('aid', Number.isInteger(cmd.id) ? cmd.id : 'auto').catch(fail);
        if (this.cur) this.cur.audioIdx = streamIndexFromMpvId(this.cur.streams, 'Audio', cmd.id);
        this._report('AudioTrackChange');
        break;
      case 'sub':
        if (transcode) {
          this._reload({ subtitleIndex: Number.isInteger(cmd.id) ? cmd.id : -1 });
          break;
        }
        m.setProperty('sid', Number.isInteger(cmd.id) ? cmd.id : 'no').catch(fail);
        if (this.cur) this.cur.subIdx = Number.isInteger(cmd.id) ? streamIndexFromMpvId(this.cur.streams, 'Subtitle', cmd.id) : -1;
        this._report('SubtitleTrackChange');
        break;
      case 'sub-delay':
        m.setProperty('sub-delay', num(cmd.value, -60, 60)).catch(fail);
        break;
      case 'audio-delay':
        m.setProperty('audio-delay', num(cmd.value, -60, 60)).catch(fail);
        break;
      case 'sub-scale':
        m.setProperty('sub-scale', num(cmd.value, 0.3, 3, 1)).catch(fail);
        break;
      case 'channels':
        this._setChannels(String(cmd.value));
        break;
      case 'quality': {
        // Qualitaet waehrend der Wiedergabe: neue Bitratengrenze, der Server liefert Original (Direct Play) oder einen Transcode.
        // Gilt bis zum Ende der Wiedergabe (auch fuer folgende Folgen), die Einstellung bleibt unveraendert.
        const mbps = Number(cmd.mbps);
        if (!Number.isFinite(mbps) || mbps < 0 || mbps > 500 || this.busy || !this.cur) break;
        if (mbps > 0 && this.getSettings().player.allowTranscode === false) break;
        if (mbps === this._qualityMbps()) break;
        this.quality = mbps;
        this._reload();
        break;
      }
      case 'stats':
        // Die Technik-Info braucht Werte, die sich bei jedem Bild aendern: nur beobachten, solange sie offen ist.
        m.observeStats(!!cmd.on);
        break;
      case 'aspect':
        this._setAspect(cmd.mode);
        break;
      case 'fullscreen':
        if (this.host && !this.host.isDestroyed()) this.host.setFullScreen(typeof cmd.value === 'boolean' ? cmd.value : !this.host.isFullScreen());
        break;
      case 'skip': {
        const seg = this.cur?.segments.find((s) => this.state.position >= s.start && this.state.position < s.end);
        if (seg) m.command('seek', seg.end, 'absolute').catch(fail);
        break;
      }
      case 'next':
        if (this.cur?.next && !this.busy) {
          this.busy = true;
          const sid = this._session;
          this._switchItem({ itemId: this.cur.next.Id, resume: false })
            .catch((e) => {
              if (!(e instanceof Cancelled) && this._session === sid) this._push({ phase: 'error', error: e.message });
            })
            .finally(() => {
              if (this._session === sid) this.busy = false;
            });
        }
        break;
      case 'play-episode':
        // Folge aus der Liste "Folgen": nur eine Folge dieser Serie (so wie sie die Liste zuletzt bekam), ab der gemerkten Position, andere Eintraege und die laufende Folge ignorieren
        if (typeof cmd.id === 'string' && this.cur?.episodeIds?.has(cmd.id) && cmd.id !== this.cur.item.Id && !this.busy) {
          this.busy = true;
          const sid = this._session;
          this._switchItem({ itemId: cmd.id, resume: true })
            .catch((e) => {
              if (!(e instanceof Cancelled) && this._session === sid) this._push({ phase: 'error', error: e.message });
            })
            .finally(() => {
              if (this._session === sid) this.busy = false;
            });
        }
        break;
      case 'window': {
        // Die Windows-Fensterknoepfe liegen unter dem Video; die Steuerung stellt eigene bereit (auch Verschieben per Ziehen).
        const h = this.host;
        if (!h || h.isDestroyed()) break;
        if (cmd.action === 'drag-start') this._dragOrigin = h.isMaximized() || h.isFullScreen() ? null : h.getPosition();
        else if (cmd.action === 'drag-move') {
          if (this._dragOrigin && Number.isFinite(cmd.dx) && Number.isFinite(cmd.dy)) h.setPosition(Math.round(this._dragOrigin[0] + cmd.dx), Math.round(this._dragOrigin[1] + cmd.dy));
        } else if (cmd.action === 'minimize') h.minimize();
        else if (cmd.action === 'maximize') (h.isMaximized() ? h.unmaximize() : h.maximize());
        else if (cmd.action === 'close') h.close();
        break;
      }
      case 'ui':
        // Untertitel ueber die Steuerleiste schieben, solange sie sichtbar ist (verhindert Verdeckung)
        m.setProperty('sub-pos', cmd.visible ? Math.min(80, this.getSettings().player.subtitlePos ?? 100) : this.getSettings().player.subtitlePos ?? 100).catch(fail);
        break;
      case 'close':
        this.stop();
        break;
      default:
        break;
    }
  }

  _setAspect(mode) {
    const m = this.mpv;
    const fail = () => {};
    m.setProperty('keepaspect', mode !== 'stretch').catch(fail);
    m.setProperty('panscan', mode === 'fill' ? 1 : 0).catch(fail);
    const map = { '16:9': '16:9', '4:3': '4:3', '2.39:1': '2.39:1', '21:9': '21:9' };
    m.setProperty('video-aspect-override', map[mode] ?? '-1').catch(fail);
    this._push({ aspect: mode ?? 'auto' });
  }

  // ---------- Zustand -> Overlay ----------

  _push(patch) {
    Object.assign(this.state, patch);
    Object.assign(this.pending, patch);
    if ('phase' in patch || 'paused' in patch || 'speed' in patch || 'duration' in patch) this.emit('nowplaying');
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const p = this.pending;
      this.pending = {};
      if (this.overlay && !this.overlay.isDestroyed() && !this.overlay.webContents.isLoading()) this.overlay.webContents.send('player:state', p);
    }, FLUSH_MS);
  }

  // ---------- Ende ----------

  /**
   * Beendet die Wiedergabe sofort: Position festhalten, Meldung an den Server im Hintergrund, Oberflaeche und mpv schliessen.
   * Der Server darf dabei beliebig lange brauchen. Das Ereignis "closed" folgt, sobald die Position beim Server angekommen ist
   * (hoechstens STOP_WAIT_MS spaeter), damit die Listen "Weiterschauen" und "Als Naechstes" nicht veraltet geladen werden.
   */
  stop(atEnd = false) {
    if (this._stopPromise) return this._stopPromise;
    this.stopping = true;
    this._session++; // laufende Starts erkennen, dass sie nicht mehr gebraucht werden
    this.busy = false;
    const report = this._sendStopReport(this._takeStopReport(atEnd));
    const info = this.lastStopped ?? null;
    this._stopPromise = this._teardown()
      .catch(() => {})
      .then(() => {
        this.stopping = false;
        this._stopPromise = null;
      });
    const done = this._stopPromise;
    done
      .then(() => Promise.race([report.then(() => true), sleep(STOP_WAIT_MS).then(() => false)]))
      .then((reported) => {
        this.emit('closed', info);
        if (!reported) report.then(() => this.emit('reported', info));
      });
    return done;
  }

  /** Raeumt alles ab. Zustand wird zuerst vollstaendig uebernommen und geleert, damit ein erneuter Aufruf nichts doppelt tut. */
  async _teardown() {
    if (this._volTimer) this._persistVolume(true); // eine noch nicht gespeicherte Lautstaerke nicht verlieren
    clearTimeout(this.flushTimer);
    clearInterval(this.reportTimer);
    clearInterval(this._audioTimer);
    clearTimeout(this._seekTimer);
    const { mpv, host, overlay, ownsHost, zorder, _offHost: offHost, _sleepId: sleepId } = this;
    this.flushTimer = this.reportTimer = this._audioTimer = this._seekTimer = null;
    this.mpv = this.host = this.overlay = this.zorder = this._offHost = this._sleepId = null;
    this.cur = null;
    this.state = {};
    this.pending = {};
    this.emit('nowplaying'); // nichts laeuft mehr
    this._pausedByMinimize = false;
    this._audioFellBack = false;
    this.quality = undefined;
    this._seekAcc = 0;
    this.mpvBuf = null;
    if (!mpv && !host && !overlay) return;

    offHost?.();
    // Ton sofort aus, Bedienung weg, dann mpv beenden: mit dem Prozess verschwindet auch sein Videofenster.
    mpv?.setProperty('pause', true).catch(() => {});
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    try {
      await mpv?.quit();
    } catch {
      /* ignorieren */
    }
    zorder?.stop();
    if (sleepId != null) powerSaveBlocker.stop(sleepId);
    if (host && !host.isDestroyed()) {
      if (ownsHost) {
        host.removeAllListeners('close');
        host.destroy();
      } else {
        // Das Hauptfenster bleibt bestehen: Vollbild nur verlassen, wenn die Wiedergabe es erst ausgeloest hat.
        if (host.isFullScreen() && !this.hostWasFullScreen) host.setFullScreen(false);
        host.focus();
      }
    }
    if (host) this.emit('active', false);
  }
}

module.exports = { PlayerController, PlayerError };
