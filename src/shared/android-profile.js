/* Gemeinsames Modul: Geraeteprofil der Android-App (Media3) fuer PlaybackInfo, gebaut aus dem, was das Geraet wirklich abspielt
   (JellycloudPlayerPlugin.codecs: Decoder des Systems und Ton-Durchleitung an die Ausgabe). Davon haengt ab, ob der Server die Datei unveraendert
   schickt oder umwandelt:
   - Direct Play fuer jedes Bild- und Tonformat, fuer das es einen Decoder gibt (AC3, E-AC3, DTS, TrueHD nur mit Decoder oder Durchleitung).
   - Muss der Server umwandeln, darf er HEVC liefern bzw. das HEVC-Bild unveraendert lassen, wenn das Geraet HEVC kann; sonst H.264. Bisher stand
     dort nur H.264: schon eine HEVC-Datei mit AC3-Ton wurde dann komplett nach H.264 umgerechnet, obwohl nur der Ton haette umgewandelt werden muessen.
   - Grenzen nur, wo das Geraet wirklich nicht kann: 10 Bit, Bildgroesse des Decoders, Dolby Vision ohne HDR10-Basis (Profil 5) ohne DV-Decoder.
   Ohne Angaben des Geraets (caps null) gilt, was jedes Android-Handy ab Version 5 kann.
   Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCAndroidProfile, mobile/host-capacitor.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCAndroidProfile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Container, die Media3 selbst oeffnet (Matroska, MP4/MOV, WebM, MPEG-TS, AVI). */
  const CONTAINERS = 'mp4,m4v,mov,mkv,webm,ts,mpegts,avi';
  /** Ton, den Media3 auf jedem Android-Geraet ohne Zusatz abspielt. */
  const BASE_AUDIO = ['aac', 'mp3', 'opus', 'flac', 'vorbis'];
  /** Ton, den es nur mit Decoder des Systems oder Durchleitung (HDMI, Receiver) gibt. Schluessel = Feld in caps.audio bzw. caps.passthrough. */
  const OPTIONAL_AUDIO = [
    ['ac3', 'ac3'],
    ['eac3', 'eac3'],
    ['dts', 'dts'],
    ['truehd', 'truehd'],
    ['mp2', 'mp2']
  ];
  /** Ohne Angaben des Geraets: Decoder, die jedes Android-Handy hat (H.264, HEVC, VP8/VP9; Android 5+). */
  const FALLBACK = { video: { h264: {}, hevc: { tenBit: true }, vp8: {}, vp9: {} }, audio: {}, passthrough: {} };
  const TEXT_SUBS = ['srt', 'subrip', 'vtt', 'webvtt', 'ass', 'ssa'];
  /** Untertitel, die Media3 aus der Datei liest (Text, PGS, DVD- und DVB-Untertitel, mov_text in MP4): sonst brennt der Server sie ins Bild. */
  const EMBED_SUBS = ['srt', 'subrip', 'vtt', 'webvtt', 'ass', 'ssa', 'mov_text', 'pgssub', 'pgs', 'dvdsub', 'dvbsub'];

  const isObj = (v) => !!v && typeof v === 'object';
  const positive = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

  /** Bringt die Antwort des Plugins in eine feste Form; ohne brauchbare Antwort die Annahme FALLBACK. */
  function normalizeCaps(raw) {
    const src = isObj(raw) && isObj(raw.video) && isObj(raw.video.h264) ? raw : FALLBACK;
    const video = {};
    for (const [k, v] of Object.entries(src.video)) {
      if (!isObj(v)) continue;
      video[k] = { maxWidth: positive(v.maxWidth), maxHeight: positive(v.maxHeight), tenBit: v.tenBit === true, hardware: v.hardware !== false };
    }
    const flags = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([, v]) => v === true));
    return { video, audio: flags(src.audio), passthrough: flags(src.passthrough), dolbyVision: src.dolbyVision === true };
  }

  /**
   * Welche Bildformate unveraendert laufen. AV1 nur mit Decoder in der Hardware: der Software-Decoder schafft grosse Dateien auf vielen Handys nicht
   * fluessig, dann ist HEVC vom Server besser.
   */
  function videoCodecs(caps) {
    const v = caps.video;
    return [
      ['h264', 'h264'],
      ['hevc', 'hevc'],
      ['vp9', 'vp9'],
      ['vp8', 'vp8'],
      ['av1', 'av1'],
      ['mpeg2', 'mpeg2video'],
      ['mpeg4', 'mpeg4']
    ]
      .filter(([k]) => v[k] && (k !== 'av1' || v[k].hardware))
      .map(([, name]) => name);
  }

  function audioCodecs(caps) {
    return [...BASE_AUDIO, ...OPTIONAL_AUDIO.filter(([k]) => caps.audio[k] || caps.passthrough[k]).map(([, name]) => name)];
  }

  /** Grenzen je Bildformat: Groesse des Decoders, 10 Bit nur mit passendem Profil, Dolby Vision Profil 5 nur mit DV-Decoder. */
  function codecProfiles(caps, codecs) {
    const out = [];
    for (const codec of codecs) {
      const key = codec === 'mpeg2video' ? 'mpeg2' : codec;
      const c = caps.video[key];
      if (!c) continue;
      const conditions = [];
      if (c.maxWidth) conditions.push({ Condition: 'LessThanEqual', Property: 'Width', Value: String(c.maxWidth), IsRequired: false });
      if (c.maxHeight) conditions.push({ Condition: 'LessThanEqual', Property: 'Height', Value: String(c.maxHeight), IsRequired: false });
      // H.264 mit 10 Bit (Hi10P) kann kein Android-Decoder; HEVC, VP9 und AV1 nur mit Main-10- bzw. Profil-2-Unterstuetzung
      if (codec === 'h264' || ((codec === 'hevc' || codec === 'vp9' || codec === 'av1') && !c.tenBit)) {
        conditions.push({ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false });
      }
      // Dolby Vision ohne Basis (Profil 5) zeigt ohne DV-Decoder falsche Farben; Profil 7/8 laufen ueber ihre HDR10-/SDR-Basis
      if ((codec === 'hevc' || codec === 'av1') && !caps.dolbyVision) {
        conditions.push({ Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVI', IsRequired: false });
      }
      if (conditions.length) out.push({ Type: 'Video', Codec: codec, Conditions: conditions });
    }
    return out;
  }

  /**
   * Das Geraeteprofil. maxBitrate: Obergrenze der Anfrage in bit/s (src/shared/bitrate.js planBitrate, immer eine Zahl); staticFloor: so hoch
   * mindestens fuer unveraenderte Dateien (Bitrate.UNLIMITED_FLOOR); audioChannels: Kanaele beim Umwandeln des Tons (outputChannelLimit).
   */
  function build({ maxBitrate, audioChannels = 6, caps = null, staticFloor = 0, fallback = false } = {}) {
    const c = normalizeCaps(caps);
    const video = videoCodecs(c);
    const audio = audioCodecs(c);
    // Beim Umwandeln: HEVC zuerst (der Server codiert in das erste Format, wenn er darf), Bild und Ton wenn moeglich unveraendert uebernehmen.
    // fallback (der Decoder ist an der Datei gescheitert): nur H.264 und AAC, sonst kaeme dasselbe Bild bzw. derselbe Ton unveraendert zurueck
    const hlsVideo = c.video.hevc && !fallback ? 'hevc,h264' : 'h264';
    const hlsAudio = fallback ? 'aac' : ['aac', 'mp3', ...['ac3', 'eac3'].filter((k) => audio.includes(k))].join(',');
    return {
      Name: 'Jellycloud Player (Android, Media3)',
      MaxStreamingBitrate: maxBitrate,
      MaxStaticBitrate: Math.max(positive(staticFloor), positive(maxBitrate)),
      MusicStreamingTranscodingBitrate: 384000,
      DirectPlayProfiles: [{ Type: 'Video', Container: CONTAINERS, VideoCodec: video.join(','), AudioCodec: audio.join(',') }],
      TranscodingProfiles: [
        {
          Type: 'Video',
          Container: 'ts',
          Protocol: 'hls',
          Context: 'Streaming',
          VideoCodec: hlsVideo,
          AudioCodec: hlsAudio,
          MaxAudioChannels: String(audioChannels),
          MinSegments: 1,
          BreakOnNonKeyFrames: true,
          EnableSubtitlesInManifest: false
        }
      ],
      ContainerProfiles: [],
      CodecProfiles: codecProfiles(c, video),
      ResponseProfiles: [],
      SubtitleProfiles: [...TEXT_SUBS.map((Format) => ({ Format, Method: 'External' })), ...EMBED_SUBS.map((Format) => ({ Format, Method: 'Embed' }))]
    };
  }

  return { build, normalizeCaps, videoCodecs, audioCodecs, CONTAINERS, FALLBACK };
});
