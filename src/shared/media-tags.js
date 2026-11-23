/* Gemeinsames Modul: Tags fuer Bildqualitaet, Tonformat, Technik und Wiedergabe. Reine Regeln ohne Oberflaeche: welche Tags ein Titel
   bekommt, in welcher Reihenfolge, und die fest gerechneten Farben jedes Tags. Gezeichnet wird in src/renderer/js/tags.js.
   Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCMediaTags); braucht src/shared/media.js, src/shared/accent.js und
   src/shared/seerr-state.js (Staende bei Seerr werden ebenfalls als Tag gezeichnet).
   Vorlage: Jellycloud/Core/MediaTags.swift und Jellycloud/Design/MediaTagView.swift der Apple-App (Build 86 bis 93).

   Grundsaetze wie in der Apple-App: nur anzeigen, was der Server ausdruecklich nennt (Atmos und DTS:X nur mit Nachweis, siehe
   JCMedia.premiumAudio); nichts doppelt (4K einmal, neben einem bestimmten HDR-Format kein allgemeines "HDR", ein Premium-Ton-Tag
   ersetzt den Namen seines Codecs); Tags haben feste Farben, unabhaengig von Akzentfarbe, Design und Einstellungen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./media'), require('./accent'), require('./seerr-state'));
  else root.JCMediaTags = factory(root.JCMedia, root.JCAccent, root.JCSeerrState);
})(typeof self !== 'undefined' ? self : this, function (Media, Accent, SeerrState) {
  'use strict';

  /** Gruppe einer Art: Premium-Bild, Premium-Ton, Wiedergabe, Stand bei Seerr, gewoehnliche Angabe. */
  var GROUP = {
    uhd: 'premiumVideo', dolbyVision: 'premiumVideo', hdr10Plus: 'premiumVideo', hdr10: 'premiumVideo', hdr: 'premiumVideo', hlg: 'premiumVideo',
    atmos: 'premiumAudio', dtsX: 'premiumAudio', trueHD: 'premiumAudio', dtsHDMA: 'premiumAudio', flac: 'premiumAudio', lpcm: 'premiumAudio',
    directPlay: 'playback', directStream: 'playback', transcode: 'playback',
    seerrAvailable: 'status', seerrPartial: 'status', seerrRequested: 'status', seerrApproved: 'status', seerrProcessing: 'status', seerrDeclined: 'status', seerrFailed: 'status',
    neutral: 'neutral'
  };

  /**
   * Zwei Farben je hervorgehobenem Tag (links -> rechts, sRGB). 4K hat eine feste Schrift und leuchtet 1,3-fach. Quelle: MediaTagStyle.style
   * der Apple-App; Notizen/design-system.md, Abschnitt Tags. Fuer gewoehnliche Angaben (neutral) gibt es keinen Eintrag.
   */
  var STYLES = {
    uhd: { start: '#ffae00', end: '#ffd700', fixedInk: '#fff0a3', glowBoost: 1.3 }, // warmes Gold -> leuchtendes Goldgelb
    dolbyVision: { start: '#8b5cf6', end: '#4f46e5' }, // Violett -> Indigo
    hdr10Plus: { start: '#ff8a3d', end: '#ef4444' }, // Orange -> Rot
    hdr10: { start: '#ffc233', end: '#ff9a1f' }, // Bernstein -> Goldorange
    hdr: { start: '#ffc233', end: '#ff9a1f' },
    hlg: { start: '#2dd4bf', end: '#3b82f6' }, // Tuerkis -> Blau
    atmos: { start: '#a5d8ff', end: '#6366f1' }, // Eisblau -> Indigo
    dtsX: { start: '#a855f7', end: '#ec4899' }, // Violett -> Magenta
    trueHD: { start: '#14b8a6', end: '#22d3ee' }, // Tuerkis -> Cyan
    dtsHDMA: { start: '#d7dbe2', end: '#ebd9b0' }, // Silber -> Champagner
    flac: { start: '#86efac', end: '#22c55e' }, // Mint -> Gruen (auch ALAC)
    lpcm: { start: '#d1d5db', end: '#a5d8ff' }, // Silber -> Eisblau
    directPlay: { start: '#0ea371', end: '#6ee7c5' }, // Smaragdgruen -> Mintgruen
    directStream: { start: '#1d4ed8', end: '#60a5fa' }, // Dunkelblau -> Hellblau
    transcode: { start: '#ffb020', end: '#f25c05' } // Bernstein -> kraeftiges Orange
  };

  /**
   * Staende bei Seerr haben keine eigene Palette: sie nehmen die Farbpaare der Wiedergabe- und HDR-Tags nach ihrer Bedeutung (wie
   * MediaTagStyle der Apple-App). Gruen: da; Tuerkis -> Blau: teilweise da; Blau: angefragt, genehmigt; Orange: in Arbeit; Orange -> Rot:
   * abgelehnt, gescheitert. Welcher Stand welche Art bekommt, steht allein in seerr-state.js (TAG_KIND).
   */
  var SEERR_STYLE = {
    seerrAvailable: 'directPlay', seerrPartial: 'hlg', seerrRequested: 'directStream', seerrApproved: 'directStream',
    seerrProcessing: 'transcode', seerrDeclined: 'hdr10Plus', seerrFailed: 'hdr10Plus'
  };
  var styleOf = function (kind) { return STYLES[kind] || STYLES[SEERR_STYLE[kind]] || null; };

  /** Feste Staerken fuer alle hervorgehobenen Tags (keine Einstellung). */
  var STRENGTH = {
    fillLuminance: { start: 0.018, end: 0.066 }, // relative Leuchtdichte der Flaeche links und rechts: dunkel, ueberall gleich hell
    fillOpacity: 0.96,
    sheen: { top: 0.06, bottom: 0.12 }, // Tiefe: oben ein Hauch Weiss, unten ein Hauch Schwarz
    inkLuminance: 0.86, // Schrift: Mitte des Verlaufs aufgehellt bis zu dieser Leuchtdichte (mindestens 7:1 zur hellsten Stelle unter ihr)
    outlineLift: 0.14, // Kontur: die zwei Farben je 14 % zu Weiss
    outlineOpacity: 0.95,
    glowOpacity: 0.6, // Schein an der Kontur
    calmGlow: 0.45, // Wiedergabe-Tags auf der Detailseite leuchten ruhiger, damit sie die Formate der Datei nicht uebertoenen
    calmOutline: 0.7
  };

  /** Masse der zwei Groessen (CSS-Pixel = Punkte der Apple-App): klein auf Karten, im Banner und im Player, normal auf der Detailseite. */
  var SIZES = {
    compact: { font: 9.5, height: 17, padX: 7, gap: 4, reach: 3.5 },
    regular: { font: 12, height: 22, padX: 9, gap: 8, reach: 5 }
  };

  // ---------- Farbrechnung ----------
  var toRgb = function (hex) { return Accent.hexToRgb(hex); };
  var toHex = function (rgb) { return '#' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); };
  function mix(a, b, t) {
    var ca = toRgb(a), cb = toRgb(b);
    return toHex([0, 1, 2].map(function (i) { return ca[i] * (1 - t) + cb[i] * t; }));
  }
  var luminance = function (hex) { return Accent.luminance(toRgb(hex)); };
  /** Die Farbe auf eine Leuchtdichte gebracht: abgedunkelt (auf Schwarz zu) oder aufgehellt (auf Weiss zu), der Farbton bleibt. */
  function toned(color, target) {
    var toward = luminance(color) > target ? '#000000' : '#ffffff';
    var low = 0, high = 1;
    for (var i = 0; i < 24; i++) {
      var t = (low + high) / 2;
      var l = luminance(mix(color, toward, t));
      var tooFar = toward === '#000000' ? l < target : l > target;
      if (tooFar) high = t;
      else low = t;
    }
    return mix(color, toward, (low + high) / 2);
  }

  var paintCache = {};
  /**
   * Alles, was die Darstellung eines hervorgehobenen Tags braucht, einmal gerechnet: Flaeche (fillStart, fillEnd), Kontur (outlineStart,
   * outlineEnd), Schrift (ink), Schein (glowStart, glowEnd, glowBoost). null fuer gewoehnliche Angaben.
   */
  function paint(kind) {
    var s = styleOf(kind);
    if (!s) return null;
    if (!paintCache[kind]) {
      paintCache[kind] = {
        fillStart: toned(s.start, STRENGTH.fillLuminance.start),
        fillEnd: toned(s.end, STRENGTH.fillLuminance.end),
        outlineStart: mix(s.start, '#ffffff', STRENGTH.outlineLift),
        outlineEnd: mix(s.end, '#ffffff', STRENGTH.outlineLift),
        ink: s.fixedInk || toned(mix(s.start, s.end, 0.5), STRENGTH.inkLuminance),
        glowStart: s.start,
        glowEnd: s.end,
        glowBoost: s.glowBoost || 1
      };
    }
    return paintCache[kind];
  }

  /**
   * Wie stark ein Tag leuchtet (Deckkraft des Scheins an der Kontur, Deckkraft der Kontur): ueberall voll, nur Wiedergabe-Tags auf der
   * Seite (Detailseite, surface 'page') ruhiger. surface: 'image' (Karten, Banner) | 'dark' (Player) | 'page' (Detailseite).
   */
  function emphasis(kind, surface) {
    var p = paint(kind);
    var calm = GROUP[kind] === 'playback' && surface === 'page';
    return {
      glow: Math.min(1, STRENGTH.glowOpacity * (p ? p.glowBoost : 1) * (calm ? STRENGTH.calmGlow : 1)),
      outline: calm ? STRENGTH.calmOutline : STRENGTH.outlineOpacity
    };
  }

  /** Hellste Stelle der Flaeche unter der Schrift ueber einem Hintergrund (Pruefung der Lesbarkeit): helles Ende mit dem Licht von oben. */
  function surfaceOver(kind, background) {
    var p = paint(kind);
    return mix(mix(background, p.fillEnd, STRENGTH.fillOpacity), '#ffffff', STRENGTH.sheen.top / 2);
  }
  var contrast = function (a, b) { return Accent.contrast(luminance(a), luminance(b)); };

  // ---------- Tags ----------
  function tag(kind, text, short) {
    return { kind: kind, text: text, short: short || text, group: GROUP[kind] || 'neutral', highlighted: kind !== 'neutral' };
  }
  var neutral = function (text) { return tag('neutral', text); };

  /** Aufloesung: 4K als Premium-Tag, darunter neutral ("HD" fuer 1080p, sonst "1440p", "720p", "SD"). */
  function resolution(w, h) {
    var r = Media.resolutionLabel(w, h);
    if (r === '4K') return tag('uhd', '4K');
    if (r === '1080p') return neutral('HD');
    return r ? neutral(r) : null;
  }

  /** Das HDR-Format des Bildes, genau eines (Dolby Vision vor HDR10+ vor HDR10 vor HLG; "HDR" nur ohne bestimmtes). */
  function hdr(video) {
    var info = Media.hdrLabel(video);
    if (!info) return null;
    if (info.label === 'Dolby Vision') return tag('dolbyVision', 'Dolby Vision');
    if (info.label === 'HDR10+') return tag('hdr10Plus', 'HDR10+');
    if (info.label === 'HDR10') return tag('hdr10', 'HDR10');
    if (info.label === 'HLG') return tag('hlg', 'HLG');
    return tag('hdr', 'HDR');
  }

  var PREMIUM_AUDIO = {
    atmos: ['atmos', 'Dolby Atmos', 'Atmos'],
    dtsx: ['dtsX', 'DTS:X'],
    truehd: ['trueHD', 'Dolby TrueHD', 'TrueHD'],
    dtshdma: ['dtsHDMA', 'DTS-HD MA'],
    flac: ['flac', 'FLAC'],
    lpcm: ['lpcm', 'LPCM'],
    alac: ['flac', 'ALAC'] // verlustfrei wie FLAC, dieselbe Gestaltung
  };
  /** Das Premium-Tonformat einer Spur als Tag (Regeln in JCMedia.premiumAudio), sonst null. */
  function premiumAudio(audio) {
    var p = Media.premiumAudio(audio);
    var m = p && PREMIUM_AUDIO[p.kind];
    return m ? tag(m[0], m[1], m[2]) : null;
  }

  var AUDIO_CODEC_NAMES = { aac: 'AAC', ac3: 'AC3', eac3: 'EAC3', dts: 'DTS', truehd: 'TrueHD', flac: 'FLAC', alac: 'ALAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis' };
  /** Kurzname eines Tonformats als gewoehnliche Angabe. */
  function audioCodecName(codec) {
    var c = String(codec || '').toLowerCase();
    if (!c) return null;
    return AUDIO_CODEC_NAMES[c] || (c.indexOf('pcm') === 0 ? 'PCM' : c.toUpperCase());
  }
  /** Kanaele als gewoehnliche Angabe ("Mono", "Stereo", "5.1", "7.1", sonst die Zahl); lang 'en' fuer die Zahl mit "channels". */
  function channels(n, lang) {
    if (n === 1) return 'Mono';
    if (n === 2) return 'Stereo';
    if (n === 6) return '5.1';
    if (n === 8) return '7.1';
    return n > 0 ? n + (lang === 'en' ? ' channels' : ' Kanäle') : null;
  }

  var VIDEO_CODEC_NAMES = { hevc: 'HEVC', h265: 'HEVC', h264: 'H.264', avc: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', vc1: 'VC-1', mpeg4: 'MPEG-4' };
  var streamsOf = function (source) { return (source && source.MediaStreams) || []; };
  var videoOf = function (source) { return streamsOf(source).filter(function (s) { return s.Type === 'Video'; })[0] || null; };
  /** Die Tonspur, die ohne Wahl gespielt wird: die als Standard genannte, sonst die erste. */
  function defaultAudio(source) {
    var audios = streamsOf(source).filter(function (s) { return s.Type === 'Audio'; });
    return audios.filter(function (s) { return s.Index === (source && source.DefaultAudioStreamIndex); })[0] || audios.filter(function (s) { return s.IsDefault; })[0] || audios[0] || null;
  }

  /** (1) Premium-Aufloesung, (2) HDR-Format, (3) Premium-Tonformat einer Datei; audio: gewaehlte Spur, sonst die Standardspur. */
  function premium(source, audio) {
    var video = videoOf(source);
    var out = [];
    var res = video ? resolution(video.Width, video.Height) : null;
    if (res && res.highlighted) out.push(res);
    var h = hdr(video);
    if (h) out.push(h);
    var a = premiumAudio(audio || defaultAudio(source));
    if (a) out.push(a);
    return out;
  }

  /** (4) Die weiteren technischen Angaben: gewoehnliche Aufloesung, Bildcodec, gewoehnliches Tonformat (nicht neben einem Premium-Ton), Kanaele. */
  function technical(source, audio, lang) {
    var video = videoOf(source);
    var a = audio || defaultAudio(source);
    var out = [];
    var res = video ? resolution(video.Width, video.Height) : null;
    if (res && !res.highlighted) out.push(res);
    var vc = video && VIDEO_CODEC_NAMES[String(video.Codec || '').toLowerCase()];
    if (vc) out.push(neutral(vc));
    if (!premiumAudio(a)) {
      var name = audioCodecName(a && a.Codec);
      if (name) out.push(neutral(name));
    }
    var ch = channels(a && a.Channels, lang);
    if (ch) out.push(neutral(ch));
    return out;
  }

  var PLAYBACK = { DirectPlay: ['directPlay', 'Direct Play'], DirectStream: ['directStream', 'Direct Stream'], Transcode: ['transcode', 'Transcoding'] };
  /** Wie der Server liefert (PlayMethod von Jellyfin: DirectPlay | DirectStream | Transcode) als Tag, sonst null. */
  function playback(method) {
    var m = PLAYBACK[method];
    return m ? tag(m[0], m[1]) : null;
  }

  /**
   * Tags einer Datei in der Reihenfolge der Detailseite: Premium-Aufloesung, HDR-Format, Premium-Tonformat, dann (sobald ermittelt) wie der
   * Server liefert, dann die weiteren technischen Angaben. Jahr, Laufzeit, Freigabe und Genre sind keine Tags.
   * @param {object} source MediaSource; @param {object} [o] { audio: gewaehlte Tonspur, playback: PlayMethod, lang }
   */
  function source(src, o) {
    o = o || {};
    var p = playback(o.playback);
    return premium(src, o.audio).concat(p ? [p] : [], technical(src, o.audio, o.lang));
  }

  /** Kurzfassung fuer Karten, Banner und Reihen: 4K, HDR-Format, Premium-Tonformat, danach "HD". Die Stelle zeigt davon so viele, wie sie Platz hat. */
  function card(streams) {
    if (!streams || !streams.length) return [];
    var src = { MediaStreams: streams };
    var hd = technical(src).slice(0, 1).filter(function (t) { return t.text === 'HD'; });
    return premium(src).concat(hd);
  }

  // ---------- Player: was gerade laeuft (Plan P22, Y10; MediaTags.player und Delivery der Apple-App) ----------

  /** Das HDR-Format, das bei unveraendertem Bild ankommt: Dolby Vision mit Erweiterungsschicht (Profil 7, DOVIWithEL...) laeuft als HDR10-Grundschicht (Apple-Geraete und mpv). */
  function playedHDR(video) {
    if (/^DOVIWithEL/i.test(String((video && video.VideoRangeType) || ''))) return tag('hdr10', 'HDR10');
    return hdr(video);
  }

  /**
   * Was der Server aus Bild und Ton macht, gelesen aus der Adresse des Stroms (TranscodingUrl von Jellyfin): Art der Lieferung, erlaubte Codecs (der erste,
   * den er kann), ob er einen Grund gegen die Tonspur nennt, Grenzen fuer den Ton. outputChannels: die im Geraeteprofil angefragte Kanalgrenze, falls die
   * Adresse keine nennt. method: PlayMethod (DirectPlay | DirectStream | Transcode).
   */
  function delivery(method, url, outputChannels) {
    var kind = PLAYBACK[method] ? method : 'Transcode';
    var d = { kind: kind, videoCodecs: [], audioCodecs: [], audioRejected: false, maxChannels: null, audioBitrate: null };
    if (kind === 'DirectPlay' || !url) return d;
    var query = String(url).split('?')[1] || '';
    var values = {};
    query.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      var key = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' ')).toLowerCase();
      if (key && !(key in values)) values[key] = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    });
    var list = function (name) {
      return String(values[name.toLowerCase()] || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    };
    var int = function (v) { var n = parseInt(v, 10); return isFinite(n) ? n : null; };
    d.videoCodecs = list('VideoCodec');
    d.audioCodecs = list('AudioCodec');
    d.audioRejected = String(values.transcodereasons || '').split(',').some(function (r) { r = r.trim(); return r.indexOf('Audio') === 0 || r.indexOf('SecondaryAudio') === 0; });
    d.maxChannels = int(values.transcodingmaxaudiochannels) || int(values.maxaudiochannels) || int(values.audiochannels) || (outputChannels > 0 ? outputChannels : null);
    d.audioBitrate = int(values.audiobitrate);
    return d;
  }

  /**
   * Kommt die Tonspur unveraendert an? Bei Direct Play immer; sonst, wenn der Server sie kopieren kann: ihr Codec ist erlaubt, er nennt keinen Grund gegen
   * sie, und Kanaele und Datenrate liegen in den Grenzen des Stroms (so entscheidet Jellyfin; im Zweifel gilt sie als gewandelt).
   */
  function keepsAudio(d, audio) {
    if (d.kind === 'DirectPlay') return true;
    var codec = String((audio && audio.Codec) || '').toLowerCase();
    if (!codec || d.audioCodecs.indexOf(codec) < 0 || d.audioRejected) return false;
    if (d.maxChannels && !(audio.Channels > 0 && audio.Channels <= d.maxChannels)) return false;
    if (d.audioBitrate && audio.BitRate > d.audioBitrate) return false;
    return true;
  }

  /**
   * Tags des Players in seiner Reihenfolge (Vorgabe des Nutzers fuer die Apple-App): (1) wie der Server liefert, (2) die Aufloesung, die wirklich ankommt,
   * (3) das HDR-Format, das wirklich ausgegeben wird, (4) das Tonformat, das wirklich ankommt, mit seinen Kanaelen, (5) der Bildcodec. Reicht der Platz
   * nicht, fallen die hinteren weg.
   * - Eine HDR-Datei, die neu verpackt an eine Ausgabe ohne HDR geht, gilt als Transcoding (der Server rechnet sie dann auf SDR um).
   * - Aufloesung: die gemeldete Groesse des Bildes (presented { width, height }), sonst bei unveraendertem Bild die der Datei; beim Neukodieren keine.
   * - HDR nur bei unveraendertem Bild und HDR-Ausgabe; Ton: Premium-Format nur, wenn die Spur unveraendert ankommt, sonst das Zielformat des Servers
   *   (FLAC hervorgehoben) mit den Kanaelen, die danach bleiben; Bildcodec beim Neukodieren nur, wenn die Adresse genau einen nennt.
   * o: { source, audio (gewaehlte Spur), delivery, hdrOutput, presented, lang }
   */
  function player(o) {
    var src = o.source;
    var d = o.delivery || delivery('DirectPlay');
    var video = videoOf(src);
    var audio = o.audio || defaultAudio(src);
    var toneMapped = d.kind === 'DirectStream' && !o.hdrOutput && !!hdr(video);
    var kind = toneMapped ? 'Transcode' : d.kind;
    var videoKept = kind !== 'Transcode';
    var out = [playback(kind)];
    var res = o.presented ? resolution(o.presented.width, o.presented.height) : videoKept && video ? resolution(video.Width, video.Height) : null;
    if (res) out.push(res);
    if (videoKept && o.hdrOutput) {
      var h = playedHDR(video);
      if (h) out.push(h);
    }
    var count = audio && audio.Channels;
    if (keepsAudio(d, audio)) {
      var p = premiumAudio(audio);
      var name = audioCodecName(audio && audio.Codec);
      if (p) out.push(p);
      else if (name) out.push(neutral(name));
    } else {
      var target = d.audioCodecs[0];
      if (target === 'flac') out.push(tag('flac', 'FLAC'));
      else if (audioCodecName(target)) out.push(neutral(audioCodecName(target)));
      if (d.maxChannels && count > d.maxChannels) count = d.maxChannels;
    }
    var ch = channels(count, o.lang);
    if (ch) out.push(neutral(ch));
    var vcodec = videoKept ? String((video && video.Codec) || '').toLowerCase() : !toneMapped && d.videoCodecs.length === 1 ? d.videoCodecs[0] : '';
    if (VIDEO_CODEC_NAMES[vcodec]) out.push(neutral(VIDEO_CODEC_NAMES[vcodec]));
    return out.filter(Boolean);
  }

  // ---------- Staende bei Seerr ----------
  /** Das Tag zu einem Stand bei Seerr (seerr-state.js STATES): Bezeichnung und Art kommen allein von dort. */
  function seerr(state, lang) {
    return tag(SeerrState.TAG_KIND[state], SeerrState.label(state, lang), SeerrState.shortLabel(state, lang));
  }

  /** Stand eines Titels (Plakate in Suche und Trends, seine Seite mit dem Stand seiner neuesten Anfrage); null fuer Titel ohne Stand. */
  function seerrAvailability(mediaStatus, request, lang) {
    var s = SeerrState.titleState(mediaStatus, request);
    return s ? seerr(s, lang) : null;
  }

  /** Stand einer Anfrage. Ohne Stand neutral: "Abgeschlossen" fuer eine erledigte, deren Titel nicht mehr da ist, sonst "Unbekannt". */
  function seerrRequest(r, lang) {
    var s = SeerrState.requestOf(r);
    if (s) return seerr(s, lang);
    return neutral(SeerrState.label(Number(r && r.status) === SeerrState.SEERR_REQUEST.COMPLETED ? 'completed' : 'unknown', lang));
  }

  /** Die Datenstroeme eines Eintrags fuer seine Karte (erste MediaSource oder MediaStreams des Eintrags). */
  function streamsOfItem(item) {
    var s = item && item.MediaSources && item.MediaSources[0];
    return (s && s.MediaStreams) || (item && item.MediaStreams) || [];
  }

  return {
    GROUP: GROUP, STYLES: STYLES, SEERR_STYLE: SEERR_STYLE, STRENGTH: STRENGTH, SIZES: SIZES,
    paint: paint, emphasis: emphasis, surfaceOver: surfaceOver, contrast: contrast, mix: mix, toned: toned, luminance: luminance,
    resolution: resolution, hdr: hdr, premiumAudio: premiumAudio, audioCodecName: audioCodecName, channels: channels,
    premium: premium, technical: technical, playback: playback, source: source, card: card, streamsOfItem: streamsOfItem, defaultAudio: defaultAudio,
    playedHDR: playedHDR, delivery: delivery, keepsAudio: keepsAudio, player: player,
    seerr: seerr, seerrAvailability: seerrAvailability, seerrRequest: seerrRequest
  };
});
