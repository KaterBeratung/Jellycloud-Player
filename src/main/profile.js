'use strict';

/**
 * Direct-Play-Logik. mpv kann praktisch jedes Format abspielen, deshalb meldet das
 * Geraeteprofil "alles" als Direct Play. Nur wenn der Nutzer ein Bitratenlimit setzt
 * (oder der Server das Medium nicht liefern kann), faellt der Server auf HLS-Transcode zurueck.
 */

const TEXT_SUB_FORMATS = ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'smi', 'sami', 'ttml', 'sub', 'microdvd'];
const IMAGE_SUB_FORMATS = ['pgs', 'pgssub', 'dvdsub', 'dvbsub', 'idx'];

/**
 * maxAudioChannels: Kanalzahl, die bei einem Transcode hoechstens geliefert werden soll. Bei Stereo-Ausgabe (2) mischt der
 * Server selbst herunter, statt Surround zu schicken, das am Ende doch nur heruntergemischt wird.
 */
function buildDeviceProfile({ maxBitrateMbps = 0, maxAudioChannels = 8 } = {}) {
  const maxBps = maxBitrateMbps > 0 ? Math.round(maxBitrateMbps * 1_000_000) : 1_000_000_000;
  const audioChannels = String(Math.min(8, Math.max(2, Math.round(Number(maxAudioChannels)) || 8)));
  return {
    Name: 'Jellycloud Player (mpv)',
    MaxStreamingBitrate: maxBps,
    MaxStaticBitrate: 1_000_000_000,
    MusicStreamingTranscodingBitrate: 384000,
    // Leere Container-/Codec-Listen bedeuten bei Jellyfin: alles ist erlaubt.
    DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Container: 'ts',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: 'hevc,h264',
        AudioCodec: 'aac,ac3,eac3,mp3,opus,flac',
        MaxAudioChannels: audioChannels,
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
        EnableSubtitlesInManifest: false
      },
      { Type: 'Audio', Container: 'mp3', Protocol: 'http', Context: 'Streaming', AudioCodec: 'mp3', MaxAudioChannels: '2' }
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    ResponseProfiles: [],
    SubtitleProfiles: [
      ...TEXT_SUB_FORMATS.flatMap((Format) => [
        { Format, Method: 'External' },
        { Format, Method: 'Embed' }
      ]),
      ...IMAGE_SUB_FORMATS.map((Format) => ({ Format, Method: 'Embed' }))
    ]
  };
}

class PlaybackError extends Error {
  constructor(message, code = 'PlaybackError') {
    super(message);
    this.name = 'PlaybackError';
    this.code = code;
  }
}

const ERROR_TEXT = {
  NotAllowed: 'Wiedergabe fuer diesen Nutzer nicht erlaubt',
  NoCompatibleStream: 'Kein kompatibler Stream verfuegbar',
  RateLimitExceeded: 'Zu viele Streams gleichzeitig'
};

function absolute(base, maybeRelative) {
  if (!maybeRelative) return null;
  return /^https?:\/\//i.test(maybeRelative) ? maybeRelative : `${base}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

/**
 * Waehlt aus der PlaybackInfo-Antwort die Quelle und die URL, die mpv oeffnen soll.
 * Das Token steht nie in der URL, mpv bekommt es als Header.
 */
function resolvePlayback({ info, base, itemId, mediaSourceId, deviceId, forceTranscode = false }) {
  const sources = info?.MediaSources ?? [];
  if (!sources.length) {
    const code = info?.ErrorCode ?? 'NoCompatibleStream';
    throw new PlaybackError(ERROR_TEXT[code] ?? `Wiedergabe nicht moeglich (${code})`, code);
  }
  const source = sources.find((s) => s.Id === mediaSourceId) ?? sources[0];
  const q = new URLSearchParams({ static: 'true', mediaSourceId: source.Id, deviceId });
  if (info.PlaySessionId) q.set('playSessionId', info.PlaySessionId);
  if (source.ETag) q.set('tag', source.ETag);
  if (source.LiveStreamId) q.set('liveStreamId', source.LiveStreamId);

  let method;
  let url;
  if (source.SupportsDirectPlay && !forceTranscode) {
    method = 'DirectPlay';
    url = `${base}/Videos/${itemId}/stream?${q}`;
  } else if (source.TranscodingUrl) {
    method = source.SupportsDirectStream && !forceTranscode ? 'DirectStream' : 'Transcode';
    url = absolute(base, source.TranscodingUrl);
  } else if (source.SupportsDirectStream) {
    method = 'DirectStream';
    url = `${base}/Videos/${itemId}/stream?${q}`;
  } else {
    throw new PlaybackError(ERROR_TEXT.NoCompatibleStream, 'NoCompatibleStream');
  }

  const streams = source.MediaStreams ?? [];
  const isTranscode = method === 'Transcode';
  // Direct Play: eingebettete Untertitel liest mpv selbst aus der Datei, nur Dateien neben dem Video kommen per URL.
  // Transcode: im HLS-Strom stecken keine Untertitel, der Server liefert auch eingebettete Textuntertitel als eigene Datei.
  const external = streams
    .filter((s) => s.Type === 'Subtitle' && s.DeliveryUrl && (isTranscode || s.IsExternal) && (s.DeliveryMethod === 'External' || (!s.DeliveryMethod && s.IsExternal)))
    .map((s) => ({
      index: s.Index,
      url: absolute(base, s.DeliveryUrl),
      title: s.DisplayTitle || s.Title || s.Language || 'Extern',
      lang: s.Language || ''
    }));

  return {
    url,
    method,
    source,
    playSessionId: info.PlaySessionId ?? null,
    mediaSourceId: source.Id,
    isTranscode,
    externalSubtitles: external,
    defaultAudioIndex: source.DefaultAudioStreamIndex ?? null,
    defaultSubtitleIndex: source.DefaultSubtitleStreamIndex ?? null
  };
}

/** mpv nummeriert Spuren je Typ ab 1 in Reihenfolge der Container-Streams. */
function mpvTrackId(mediaStreams, type, streamIndex) {
  if (streamIndex === null || streamIndex === undefined || streamIndex < 0) return null;
  const list = (mediaStreams ?? []).filter((s) => s.Type === type && !s.IsExternal).sort((a, b) => a.Index - b.Index);
  const i = list.findIndex((s) => s.Index === streamIndex);
  return i >= 0 ? i + 1 : null;
}

function streamIndexFromMpvId(mediaStreams, type, mpvId) {
  if (!mpvId || mpvId < 1) return -1;
  const list = (mediaStreams ?? []).filter((s) => s.Type === type && !s.IsExternal).sort((a, b) => a.Index - b.Index);
  return list[mpvId - 1]?.Index ?? -1;
}

// Beschreibung der Medien (Badges wie bei Infuse) liegt im gemeinsamen Modul, das auch die Oberflaeche nutzt.
const { describeMedia, resolutionLabel, hdrLabel, audioLabel, pickStreams, langMatches } = require('../shared/media');

module.exports = { buildDeviceProfile, resolvePlayback, PlaybackError, mpvTrackId, streamIndexFromMpvId, describeMedia, resolutionLabel, hdrLabel, audioLabel, pickStreams, langMatches };
