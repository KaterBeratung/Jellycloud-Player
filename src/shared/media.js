/* Gemeinsames Modul: laeuft als CommonJS im Hauptprozess und als klassisches Skript (window.JCMedia) in der Oberflaeche. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCMedia = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function resolutionLabel(w, h) {
    w = w || 0;
    h = h || 0;
    if (h >= 2000 || w >= 3600) return '4K';
    if (h >= 1300 || w >= 2500) return '1440p';
    if (h >= 1000 || w >= 1800) return '1080p';
    if (h >= 700 || w >= 1200) return '720p';
    if (w && h) return 'SD';
    return null;
  }

  function hdrLabel(video) {
    if (!video) return null;
    var t = String(video.VideoRangeType || '');
    if (/^DOVI/i.test(t)) {
      var sub = /HDR10Plus/i.test(t) ? ' + HDR10+' : /HDR10/i.test(t) ? ' + HDR10' : /HLG/i.test(t) ? ' + HLG' : '';
      var profile = video.DvProfile ? ' (P' + video.DvProfile + ')' : '';
      return { label: 'Dolby Vision', detail: 'Dolby Vision' + profile + sub, dv: true };
    }
    if (/HDR10Plus/i.test(t)) return { label: 'HDR10+', detail: 'HDR10+', dv: false };
    if (/HDR10/i.test(t)) return { label: 'HDR10', detail: 'HDR10', dv: false };
    if (/HLG/i.test(t)) return { label: 'HLG', detail: 'HLG', dv: false };
    if (String(video.VideoRange || '').toUpperCase() === 'HDR') return { label: 'HDR', detail: 'HDR', dv: false };
    return null;
  }

  var VIDEO_CODEC_NAMES = { hevc: 'HEVC', h265: 'HEVC', h264: 'H.264', avc: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', vc1: 'VC-1', mpeg4: 'MPEG-4' };

  function audioLabel(a) {
    if (!a) return null;
    var codec = String(a.Codec || '').toLowerCase();
    var profile = String(a.Profile || '');
    var title = (a.DisplayTitle || '') + ' ' + profile;
    var atmos = /atmos/i.test(title) || a.AudioSpatialFormat === 'DolbyAtmos';
    var dtsx = /dts[:\- ]?x/i.test(title) || a.AudioSpatialFormat === 'DTSX';
    var name;
    if (codec === 'truehd') name = 'Dolby TrueHD';
    else if (codec === 'eac3') name = 'Dolby Digital Plus';
    else if (codec === 'ac3') name = 'Dolby Digital';
    else if (codec === 'dts') name = /ma/i.test(profile) ? 'DTS-HD MA' : /hra|high res/i.test(profile) ? 'DTS-HD HRA' : 'DTS';
    else if (codec === 'flac') name = 'FLAC';
    else if (codec === 'opus') name = 'Opus';
    else if (codec === 'aac') name = 'AAC';
    else if (codec.indexOf('pcm') === 0) name = 'PCM';
    else name = codec ? codec.toUpperCase() : null;
    var ch = a.Channels;
    var channels = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch === 1 ? '1.0' : ch ? ch + 'ch' : null;
    return { name: name, channels: channels, atmos: atmos, dtsx: dtsx, lossless: ['truehd', 'flac'].indexOf(codec) >= 0 || /ma/i.test(profile) };
  }

  /** Kurzbeschreibung einer MediaSource fuer Badges und Info-Panels. */
  function describeMedia(source) {
    var streams = (source && source.MediaStreams) || [];
    var video = streams.filter(function (s) { return s.Type === 'Video'; })[0];
    var audios = streams.filter(function (s) { return s.Type === 'Audio'; });
    var defAudio =
      audios.filter(function (s) { return s.Index === source.DefaultAudioStreamIndex; })[0] ||
      audios.filter(function (s) { return s.IsDefault; })[0] ||
      audios[0];
    var res = video ? resolutionLabel(video.Width, video.Height) : null;
    var hdr = hdrLabel(video);
    var audio = audioLabel(defAudio);
    var badges = [];
    if (res === '4K') badges.push({ kind: 'res', text: '4K' });
    else if (res === '1080p') badges.push({ kind: 'res', text: 'HD' });
    if (hdr) badges.push({ kind: hdr.dv ? 'dv' : 'hdr', text: hdr.label });
    if (audio && audio.atmos) badges.push({ kind: 'audio', text: 'Atmos' });
    else if (audio && audio.dtsx) badges.push({ kind: 'audio', text: 'DTS:X' });
    else if (audio && audio.lossless && audio.name) badges.push({ kind: 'audio', text: audio.name });
    return {
      resolution: res,
      width: video ? video.Width || null : null,
      height: video ? video.Height || null : null,
      videoCodec: video ? VIDEO_CODEC_NAMES[String(video.Codec).toLowerCase()] || String(video.Codec).toUpperCase() : null,
      bitDepth: video ? video.BitDepth || null : null,
      fps: video ? video.RealFrameRate || video.AverageFrameRate || null : null,
      hdr: hdr ? hdr.detail : null,
      hdrLabel: hdr ? hdr.label : null,
      dolbyVision: !!(hdr && hdr.dv),
      audio: audio,
      container: (source && source.Container) || null,
      bitrate: (source && source.Bitrate) || null,
      size: (source && source.Size) || null,
      badges: badges
    };
  }

  // Jellyfin liefert Sprachen als ISO-639-2 (ger, eng, fre ...); in den Einstellungen steht ISO-639-1 (de, en, fr ...).
  var LANG_ALIASES = {
    de: ['ger', 'deu', 'de'], en: ['eng', 'en'], fr: ['fre', 'fra', 'fr'], es: ['spa', 'es'], it: ['ita', 'it'], pt: ['por', 'pt'],
    nl: ['dut', 'nld', 'nl'], pl: ['pol', 'pl'], ru: ['rus', 'ru'], tr: ['tur', 'tr'], ja: ['jpn', 'ja'], ko: ['kor', 'ko'],
    zh: ['chi', 'zho', 'zh'], sv: ['swe', 'sv'], da: ['dan', 'da'], no: ['nor', 'nob', 'no'], fi: ['fin', 'fi'], cs: ['cze', 'ces', 'cs'],
    hu: ['hun', 'hu'], ar: ['ara', 'ar'], he: ['heb', 'he'], el: ['gre', 'ell', 'el'], uk: ['ukr', 'uk'], ro: ['rum', 'ron', 'ro']
  };

  /** Sprachcode einer Spur ("ger", "deu" oder "de") als Kurzcode der Einstellungen ("de"); Unbekanntes bleibt klein geschrieben, ohne Angabe oder "und" ergibt "und". */
  function langCode(raw) {
    var v = String(raw || '').toLowerCase();
    if (!v || v === 'und' || v === 'unk') return 'und';
    for (var k in LANG_ALIASES) if (LANG_ALIASES[k].indexOf(v) >= 0) return k;
    return v;
  }

  var HEARING = /sdh|\bcc\b|closed.?caption|hearing|schwerh|hörgesch|hoergesch|hoerges/i;

  /** Art einer Untertitelspur: 'full' (normal), 'forced' (nur fremdsprachige Stellen) oder 'sdh' (fuer Hoergeschaedigte, mit Geraeuschen). */
  function subtitleKind(stream) {
    if (stream && stream.IsForced) return 'forced';
    if (stream && (stream.IsHearingImpaired || HEARING.test(String(stream.Title || '') + ' ' + String(stream.DisplayTitle || '')))) return 'sdh';
    return 'full';
  }

  /**
   * Teilt Spuren nach Sprache ein, damit lange Untertitel-Listen uebersichtlich bleiben: `shown` sind die Sprachen, die man wahrscheinlich will
   * (opts.preferred in dieser Reihenfolge, dann die Sprachen der Spuren in opts.keep, etwa die gewaehlte), `more` alle uebrigen in der Reihenfolge
   * ihres ersten Auftretens. Innerhalb einer Sprache stehen normale Spuren vor erzwungenen, diese vor denen fuer Hoergeschaedigte, sonst bleibt die Reihenfolge.
   * opts: { preferred: ['de', 'en'], keep: [spur, ...], lang: (spur) => rohe Sprache (Standard spur.Language), kind: (spur) => 'full'|'forced'|'sdh' (Standard subtitleKind) }
   * Ergebnis: { shown: [{ code, tracks }], more: [{ code, tracks }] }
   */
  function groupByLanguage(tracks, opts) {
    opts = opts || {};
    var getLang = opts.lang || function (t) { return t.Language; };
    var getKind = opts.kind || subtitleKind;
    var rank = { full: 0, forced: 1, sdh: 2 };
    var order = [];
    var byCode = {};
    (tracks || []).forEach(function (t, i) {
      var code = langCode(getLang(t));
      if (!byCode[code]) {
        byCode[code] = [];
        order.push(code);
      }
      byCode[code].push({ t: t, i: i });
    });
    var shownCodes = [];
    var want = function (code) {
      if (byCode[code] && shownCodes.indexOf(code) < 0) shownCodes.push(code);
    };
    (opts.preferred || []).forEach(function (p) { want(langCode(p)); });
    (opts.keep || []).forEach(function (t) { if (t) want(langCode(getLang(t))); });
    var make = function (code) {
      var list = byCode[code].slice().sort(function (a, b) { return (rank[getKind(a.t)] || 0) - (rank[getKind(b.t)] || 0) || a.i - b.i; });
      return { code: code, tracks: list.map(function (x) { return x.t; }) };
    };
    return {
      shown: shownCodes.map(make),
      more: order.filter(function (c) { return shownCodes.indexOf(c) < 0; }).map(make)
    };
  }

  function langMatches(stream, code) {
    var wanted = LANG_ALIASES[code] || [String(code).toLowerCase()];
    return wanted.indexOf(String((stream && stream.Language) || '').toLowerCase()) >= 0;
  }

  var EXTRA_AUDIO = /comment|kommentar|descri|deskription|audiodesk|karaoke|isolated/i;

  /** Gleiche Sprache, aber als echte Stereo-Spur (kein Kommentar, keine Audiodeskription); sonst die gegebene Spur. */
  function stereoAlternative(audios, chosen) {
    var lang = chosen && chosen.Language;
    if (!lang || lang === 'und') return chosen;
    var same = audios.filter(function (a) {
      return a.Language === lang && a.Channels === 2 && !EXTRA_AUDIO.test((a.Title || '') + ' ' + (a.DisplayTitle || ''));
    });
    same.sort(function (a, b) { return (b.IsDefault ? 1 : 0) - (a.IsDefault ? 1 : 0); });
    return same.length ? same[0] : chosen;
  }

  /**
   * Waehlt Audio- und Untertitelspur nach den Nutzereinstellungen (sonst die Vorgabe des Servers).
   * prefs: { audioLanguage, subtitleMode: server|off|forced|always|smart, subtitleLanguage }
   * outChannels: Kanaele der Tonausgabe (2 = Stereo). Bei Stereo wird, wenn es sie gibt, die Stereo-Spur derselben Sprache
   * genommen statt einer Surround-Spur, die erst heruntergemischt werden muss.
   * Gibt { audioIndex, subtitleIndex } zurueck (subtitleIndex -1 = keine).
   */
  function pickStreams(source, prefs, uiLang, outChannels) {
    prefs = prefs || {};
    var streams = (source && source.MediaStreams) || [];
    var audios = streams.filter(function (s) { return s.Type === 'Audio'; });
    var subs = streams.filter(function (s) { return s.Type === 'Subtitle'; });
    var serverAudio = source && source.DefaultAudioStreamIndex;
    var audio = serverAudio !== undefined && serverAudio !== null ? serverAudio : audios.length ? audios[0].Index : null;
    var chosen = audios.filter(function (a) { return a.Index === audio; })[0];
    if (prefs.audioLanguage && prefs.audioLanguage !== 'server') {
      var cand = audios.filter(function (a) { return langMatches(a, prefs.audioLanguage); });
      if (cand.length) {
        cand.sort(function (a, b) { return (b.IsDefault ? 1 : 0) - (a.IsDefault ? 1 : 0) || (b.Channels || 0) - (a.Channels || 0); });
        audio = cand[0].Index;
        chosen = cand[0];
      }
    }
    if (outChannels === 2 && chosen && chosen.Channels > 2) {
      chosen = stereoAlternative(audios, chosen);
      audio = chosen.Index;
    }
    var serverSub = source && source.DefaultSubtitleStreamIndex;
    var sub = serverSub === undefined || serverSub === null ? -1 : serverSub;
    var mode = prefs.subtitleMode || 'server';
    if (mode !== 'server') {
      var lang = prefs.subtitleLanguage && prefs.subtitleLanguage !== 'server' ? prefs.subtitleLanguage : uiLang || 'en';
      var inLang = subs.filter(function (s) { return langMatches(s, lang); });
      var forced = inLang.filter(function (s) { return s.IsForced; });
      var full = inLang.filter(function (s) { return !s.IsForced; });
      var firstFull = full.length ? full[0].Index : forced.length ? forced[0].Index : -1;
      var firstForced = forced.length ? forced[0].Index : -1;
      var audioIsLang = !!chosen && langMatches(chosen, lang);
      if (mode === 'off') sub = -1;
      else if (mode === 'forced') sub = firstForced;
      else if (mode === 'always') sub = firstFull;
      else if (mode === 'smart') sub = audioIsLang ? firstForced : firstFull;
    }
    return { audioIndex: audio, subtitleIndex: sub };
  }

  /** Video-ID aus einem YouTube-Link (watch?v=, youtu.be/, embed/, shorts/); null, wenn es keiner ist. */
  function youtubeId(url) {
    var m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#\/]|$)/.exec(String(url || '').trim());
    return m ? m[1] : null;
  }

  /** Erste YouTube-ID aus den Trailer-Links eines Eintrags (RemoteTrailers); null, wenn keine dabei ist. */
  function trailerVideoId(item) {
    var list = (item && item.RemoteTrailers) || [];
    for (var i = 0; i < list.length; i++) {
      var id = youtubeId(list[i] && list[i].Url);
      if (id) return id;
    }
    return null;
  }

  return { resolutionLabel: resolutionLabel, hdrLabel: hdrLabel, audioLabel: audioLabel, describeMedia: describeMedia, langMatches: langMatches, langCode: langCode, subtitleKind: subtitleKind, groupByLanguage: groupByLanguage, pickStreams: pickStreams, youtubeId: youtubeId, trailerVideoId: trailerVideoId, LANG_ALIASES: LANG_ALIASES };
});
