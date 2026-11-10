'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeviceProfile, resolvePlayback, mpvTrackId, streamIndexFromMpvId, describeMedia, PlaybackError, pickStreams } = require('../src/main/profile');

const BASE = 'http://srv:8096';

test('Geraeteprofil: alles ist Direct Play, Text- und Bild-Untertitel werden akzeptiert', () => {
  const p = buildDeviceProfile();
  assert.deepEqual(p.DirectPlayProfiles, [{ Type: 'Video' }, { Type: 'Audio' }]);
  assert.ok(p.MaxStreamingBitrate >= 1_000_000_000);
  const formats = (method) => p.SubtitleProfiles.filter((s) => s.Method === method).map((s) => s.Format);
  for (const f of ['srt', 'ass', 'ssa', 'vtt']) assert.ok(formats('External').includes(f) && formats('Embed').includes(f), f);
  for (const f of ['pgssub', 'dvdsub', 'dvbsub']) assert.ok(formats('Embed').includes(f), f);
  assert.ok(p.TranscodingProfiles.some((t) => t.Protocol === 'hls' && /hevc/.test(t.VideoCodec)));
});

test('Geraeteprofil: Bitratenlimit wird uebernommen', () => {
  assert.equal(buildDeviceProfile({ maxBitrateMbps: 20 }).MaxStreamingBitrate, 20_000_000);
});

const source = (over = {}) => ({
  Id: 'abc',
  ETag: 'etag1',
  Container: 'mkv',
  SupportsDirectPlay: true,
  SupportsDirectStream: true,
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: 'DOVIWithHDR10', DvProfile: 8, BitDepth: 10 },
    { Index: 1, Type: 'Audio', Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8, Language: 'eng', IsDefault: true },
    { Index: 2, Type: 'Audio', Codec: 'ac3', Channels: 6, Language: 'ger' },
    { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng' },
    { Index: 4, Type: 'Subtitle', Codec: 'srt', Language: 'ger', IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: '/Videos/x/abc/Subtitles/4/0/Stream.srt' },
    { Index: 5, Type: 'Subtitle', Codec: 'pgssub', Language: 'fra' }
  ],
  ...over
});

test('Direct Play: URL ohne Token, mit static=true', () => {
  const r = resolvePlayback({ info: { MediaSources: [source()], PlaySessionId: 'ps1' }, base: BASE, itemId: 'item1', deviceId: 'dev1' });
  assert.equal(r.method, 'DirectPlay');
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, `${BASE}/Videos/item1/stream`);
  assert.equal(u.searchParams.get('static'), 'true');
  assert.equal(u.searchParams.get('mediaSourceId'), 'abc');
  assert.equal(u.searchParams.get('playSessionId'), 'ps1');
  assert.ok(![...u.searchParams.keys()].some((k) => /token|api_key/i.test(k)), 'kein Token in der URL');
});

test('Transcode-Fallback nutzt die TranscodingUrl des Servers', () => {
  const src = source({ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: '/videos/item1/master.m3u8?x=1' });
  const r = resolvePlayback({ info: { MediaSources: [src], PlaySessionId: 'p' }, base: BASE, itemId: 'item1', deviceId: 'd' });
  assert.equal(r.method, 'Transcode');
  assert.equal(r.url, `${BASE}/videos/item1/master.m3u8?x=1`);
  assert.equal(r.isTranscode, true);
});

test('Externe Untertitel werden mit absoluter URL geliefert', () => {
  const r = resolvePlayback({ info: { MediaSources: [source()], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd' });
  assert.equal(r.externalSubtitles.length, 1);
  assert.equal(r.externalSubtitles[0].url, `${BASE}/Videos/x/abc/Subtitles/4/0/Stream.srt`);
  assert.equal(r.externalSubtitles[0].index, 4);
});

test('Transcode: eingebettete Textuntertitel kommen als Datei vom Server, im Direct Play liest mpv sie selbst', () => {
  const streams = [
    { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', DeliveryMethod: 'External', DeliveryUrl: '/Videos/x/abc/Subtitles/3/0/Stream.srt' },
    { Index: 5, Type: 'Subtitle', Codec: 'pgssub', Language: 'fra', DeliveryMethod: 'Encode' }
  ];
  const direct = resolvePlayback({ info: { MediaSources: [source({ MediaStreams: streams })], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd' });
  assert.equal(direct.externalSubtitles.length, 0, 'Direct Play: eingebetteter Untertitel steckt in der Datei');
  const tc = resolvePlayback({ info: { MediaSources: [source({ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: '/videos/i/master.m3u8', MediaStreams: streams })], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd' });
  assert.equal(tc.isTranscode, true);
  assert.deepEqual(tc.externalSubtitles.map((s) => s.index), [3], 'Transcode: Textuntertitel per URL, eingebrannte Bildtitel nicht');
});

test('Rueckfall auf Transcode: forceTranscode ignoriert Direct Play, sofern der Server eine TranscodingUrl liefert', () => {
  const src = source({ TranscodingUrl: '/videos/i/master.m3u8?a=1' });
  const normal = resolvePlayback({ info: { MediaSources: [src], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd' });
  assert.equal(normal.method, 'DirectPlay');
  const forced = resolvePlayback({ info: { MediaSources: [src], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd', forceTranscode: true });
  assert.equal(forced.method, 'Transcode');
  assert.equal(forced.url, `${BASE}/videos/i/master.m3u8?a=1`);
  assert.throws(() => resolvePlayback({ info: { MediaSources: [source({ SupportsDirectStream: false })], PlaySessionId: 'p' }, base: BASE, itemId: 'i', deviceId: 'd', forceTranscode: true }), PlaybackError);
});

test('Geraeteprofil: Transcode liefert hoechstens so viele Kanaele, wie die Ausgabe nutzt (Stereo -> 2)', () => {
  const ch = (p) => p.TranscodingProfiles.find((t) => t.Type === 'Video').MaxAudioChannels;
  assert.equal(ch(buildDeviceProfile()), '8');
  assert.equal(ch(buildDeviceProfile({ maxAudioChannels: 2 })), '2');
  assert.equal(ch(buildDeviceProfile({ maxAudioChannels: 6 })), '6');
  assert.equal(ch(buildDeviceProfile({ maxAudioChannels: 99 })), '8');
  assert.equal(ch(buildDeviceProfile({ maxAudioChannels: 'x' })), '8');
});

test('Keine Quelle -> verstaendlicher Fehler', () => {
  assert.throws(() => resolvePlayback({ info: { MediaSources: [], ErrorCode: 'NotAllowed' }, base: BASE, itemId: 'i', deviceId: 'd' }), (e) => e instanceof PlaybackError && e.code === 'NotAllowed');
});

test('mpv-Spur-IDs: Zaehlung je Typ ab 1, externe Untertitel zaehlen nicht', () => {
  const s = source().MediaStreams;
  assert.equal(mpvTrackId(s, 'Audio', 1), 1);
  assert.equal(mpvTrackId(s, 'Audio', 2), 2);
  assert.equal(mpvTrackId(s, 'Subtitle', 3), 1);
  assert.equal(mpvTrackId(s, 'Subtitle', 5), 2); // Index 4 ist extern
  assert.equal(mpvTrackId(s, 'Subtitle', 4), null);
  assert.equal(mpvTrackId(s, 'Subtitle', -1), null);
  assert.equal(streamIndexFromMpvId(s, 'Subtitle', 2), 5);
  assert.equal(streamIndexFromMpvId(s, 'Audio', 0), -1);
});

test('Medien-Badges: 4K, Dolby Vision, Atmos', () => {
  const m = describeMedia(source({ DefaultAudioStreamIndex: 1 }));
  assert.equal(m.resolution, '4K');
  assert.equal(m.dolbyVision, true);
  assert.match(m.hdr, /Dolby Vision \(P8\) \+ HDR10/);
  assert.deepEqual(m.badges.map((b) => b.text), ['4K', 'Dolby Vision', 'Atmos']);
  assert.equal(m.videoCodec, 'HEVC');
  assert.equal(m.audio.channels, '7.1');
});

test('Medien-Badges: SDR 1080p ohne HDR', () => {
  const m = describeMedia({ MediaStreams: [{ Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080, VideoRangeType: 'SDR' }, { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2, IsDefault: true }] });
  assert.equal(m.hdr, null);
  assert.deepEqual(m.badges.map((b) => b.text), ['HD']);
});

test('HDR-Varianten werden erkannt', () => {
  const label = (t) => describeMedia({ MediaStreams: [{ Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: t }] }).hdrLabel;
  assert.equal(label('HDR10'), 'HDR10');
  assert.equal(label('HDR10Plus'), 'HDR10+');
  assert.equal(label('HLG'), 'HLG');
  assert.equal(label('DOVI'), 'Dolby Vision');
  assert.equal(label('DOVIWithHLG'), 'Dolby Vision');
  assert.equal(label('SDR'), null);
});

// ---------- Spurauswahl nach Sprach-Einstellungen ----------
const multi = () => ({
  DefaultAudioStreamIndex: 1,
  DefaultSubtitleStreamIndex: -1,
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: 'hevc' },
    { Index: 1, Type: 'Audio', Codec: 'truehd', Language: 'eng', Channels: 8, IsDefault: true },
    { Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'ger', Channels: 6 },
    { Index: 3, Type: 'Audio', Codec: 'aac', Language: 'ger', Channels: 2 },
    { Index: 4, Type: 'Subtitle', Codec: 'subrip', Language: 'eng' },
    { Index: 5, Type: 'Subtitle', Codec: 'subrip', Language: 'ger' },
    { Index: 6, Type: 'Subtitle', Codec: 'subrip', Language: 'ger', IsForced: true }
  ]
});

test('Spurauswahl: ohne Vorgaben gilt die Server-Vorgabe', () => {
  assert.deepEqual(pickStreams(multi(), { audioLanguage: 'server', subtitleMode: 'server' }, 'de'), { audioIndex: 1, subtitleIndex: -1 });
  assert.deepEqual(pickStreams(multi(), undefined, 'de'), { audioIndex: 1, subtitleIndex: -1 });
});

test('Spurauswahl: bevorzugte Audiosprache (ISO 639-1 gegen ISO 639-2), bei mehreren die mit mehr Kanaelen', () => {
  assert.equal(pickStreams(multi(), { audioLanguage: 'de' }, 'de').audioIndex, 2);
  assert.equal(pickStreams(multi(), { audioLanguage: 'en' }, 'de').audioIndex, 1);
  assert.equal(pickStreams(multi(), { audioLanguage: 'fr' }, 'de').audioIndex, 1, 'ohne passende Spur bleibt die Server-Vorgabe');
});

test('Spurauswahl: Untertitel-Modi', () => {
  const p = (subtitleMode, extra = {}) => pickStreams(multi(), { audioLanguage: 'server', subtitleMode, subtitleLanguage: 'de', ...extra }, 'en');
  assert.equal(p('off').subtitleIndex, -1);
  assert.equal(p('forced').subtitleIndex, 6);
  assert.equal(p('always').subtitleIndex, 5, 'volle Untertitel vor erzwungenen');
  assert.equal(p('smart').subtitleIndex, 5, 'Ton ist Englisch, Untertitel Deutsch -> voll');
  assert.equal(pickStreams(multi(), { audioLanguage: 'de', subtitleMode: 'smart', subtitleLanguage: 'de' }, 'en').subtitleIndex, 6, 'Ton ist schon Deutsch -> nur erzwungene');
  assert.equal(p('always', { subtitleLanguage: 'fr' }).subtitleIndex, -1, 'keine passende Sprache');
  assert.equal(pickStreams(multi(), { subtitleMode: 'always', subtitleLanguage: 'server' }, 'de').subtitleIndex, 5, 'Sprache der App als Vorgabe');
});