'use strict';
/**
 * Erkennung der Tags (src/shared/media.js) nach den Regeln der Apple-App (Jellycloud/Core/MediaTags.swift, MediaInfo.swift);
 * Faelle aus JellycloudTests/MediaTagTests.swift. Bis 1.1.6 galten Atmos und DTS:X schon nach dem Namen einer Spur, DOVIInvalid als
 * Dolby Vision und jedes "ma" im Profil als DTS-HD MA; LPCM und ALAC fehlten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { premiumAudio, audioLabel, hdrLabel, describeMedia } = require('../src/shared/media');

const audio = (codec, { channels = 6, profile, spatial, title, display } = {}) => ({
  Type: 'Audio', Codec: codec, Channels: channels, Profile: profile, AudioSpatialFormat: spatial, Title: title, DisplayTitle: display
});
const kind = (a) => premiumAudio(a)?.kind ?? null;

test('Atmos nur mit Nachweis (raeumliches Format oder Profil), TrueHD ohne Atmos verlustfrei, E-AC-3 ohne Nachweis gewoehnlich', () => {
  assert.equal(kind(audio('truehd', { channels: 8 })), 'truehd');
  assert.equal(kind(audio('eac3')), null);
  assert.equal(kind(audio('truehd', { channels: 8, spatial: 'DolbyAtmos' })), 'atmos');
  assert.equal(kind(audio('eac3', { spatial: 'DolbyAtmos' })), 'atmos');
  assert.equal(kind(audio('truehd', { channels: 8, profile: 'Dolby TrueHD + Dolby Atmos' })), 'atmos');
  assert.equal(kind(audio('eac3', { profile: 'Dolby Digital Plus + Dolby Atmos' })), 'atmos');
});

test('Der frei vergebene Name einer Spur ist kein Nachweis', () => {
  assert.equal(kind(audio('eac3', { title: 'Atmos Mix', display: 'Deutsch - Atmos Mix - 5.1' })), null);
  assert.equal(kind(audio('truehd', { channels: 8, title: 'TrueHD Atmos 7.1', display: 'TrueHD Atmos 7.1' })), 'truehd');
  assert.equal(kind(audio('dts', { profile: 'DTS-HD MA', title: 'DTS:X', display: 'DTS:X' })), 'dtshdma');
  // dieselbe Pruefung ueber audioLabel, die die Oberflaeche benutzt
  const named = audioLabel(audio('eac3', { display: 'Deutsch - Atmos Mix - 5.1' }));
  assert.equal(named.atmos, false);
  assert.equal(audioLabel(audio('dts', { profile: 'DTS-HD MA', display: 'DTS:X' })).dtsx, false);
});

test('Atmos steht nie auf einem Codec, der es nicht tragen kann', () => {
  assert.equal(kind(audio('aac', { spatial: 'DolbyAtmos' })), null);
  assert.equal(kind(audio('ac3', { profile: 'Dolby Atmos' })), null);
});

test('DTS:X nur mit Nachweis, nie allein wegen DTS-HD Master Audio', () => {
  assert.equal(kind(audio('dts', { channels: 8, profile: 'DTS-HD MA' })), 'dtshdma');
  assert.equal(kind(audio('dts', { channels: 8, profile: 'DTS-HD MA', spatial: 'DTSX' })), 'dtsx');
  assert.equal(kind(audio('dts', { channels: 8, profile: 'DTS-HD MA + DTS:X' })), 'dtsx');
});

test('Verlustfrei ist nicht objektbasiert, verlustbehaftetes DTS nicht verlustfrei; LPCM ohne A-law/mu-law, ALAC', () => {
  for (const p of ['DTS', 'DTS-HD HRA', 'DTS-ES', undefined]) assert.equal(kind(audio('dts', { profile: p })), null, `DTS ${p}`);
  assert.equal(kind(audio('dts', { profile: 'DTS-ES Matrix' })), null, 'Gegenprobe zum alten /ma/i: "Matrix" ist kein Master Audio');
  assert.equal(kind(audio('dts', { profile: 'DTS-HD Master Audio' })), 'dtshdma');
  assert.deepEqual(premiumAudio(audio('flac', { channels: 2 })), { kind: 'flac', text: 'FLAC' });
  assert.deepEqual(premiumAudio(audio('pcm_s24le', { channels: 2 })), { kind: 'lpcm', text: 'LPCM' });
  assert.deepEqual(premiumAudio(audio('pcm_bluray')), { kind: 'lpcm', text: 'LPCM' });
  assert.equal(kind(audio('pcm_mulaw', { channels: 1 })), null);
  assert.equal(kind(audio('pcm_alaw', { channels: 1 })), null);
  assert.equal(premiumAudio(audio('alac', { channels: 2 }))?.text, 'ALAC');
  for (const plain of ['aac', 'ac3', 'eac3', 'mp3', 'opus', 'vorbis']) assert.equal(kind(audio(plain)), null, plain);
  assert.equal(audioLabel(audio('dts', { profile: 'DTS-ES Matrix' })).lossless, false);
  assert.equal(audioLabel(audio('pcm_s16le')).lossless, true);
  assert.equal(audioLabel(audio('pcm_mulaw')).lossless, false);
});

test('Dolby Vision: DOVIInvalid ist keines, dann gilt, was der Server sonst nennt', () => {
  const v = (rangeType, range) => ({ Type: 'Video', VideoRangeType: rangeType, VideoRange: range, Width: 3840, Height: 2160 });
  assert.equal(hdrLabel(v('DOVIInvalid', 'HDR'))?.label, 'HDR');
  assert.equal(hdrLabel(v('DOVIInvalid', 'SDR')), null);
  assert.equal(hdrLabel(v('DOVIWithSDR', 'SDR'))?.label, 'Dolby Vision');
  assert.equal(hdrLabel(v('DOVIWithEL', 'HDR'))?.label, 'Dolby Vision', 'in der Datei ist Profil 7 Dolby Vision');
  assert.equal(hdrLabel(v('DOVIWithHDR10', 'HDR'))?.label, 'Dolby Vision');
});

test('Karten-Tags: hoechstens ein Premium-Ton, LPCM und ALAC kommen dazu, Atmos nach Namen nicht', () => {
  const src = (a, rangeType = 'SDR', range = rangeType === 'SDR' ? 'SDR' : 'HDR') => ({ MediaStreams: [{ Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: rangeType, VideoRange: range }, { ...a, Index: 1 }], DefaultAudioStreamIndex: 1 });
  const texts = (s) => describeMedia(s).badges.map((b) => b.text);
  assert.deepEqual(texts(src(audio('truehd', { channels: 8, spatial: 'DolbyAtmos' }), 'DOVIWithHDR10')), ['4K', 'Dolby Vision', 'Atmos']);
  assert.deepEqual(texts(src(audio('eac3', { display: 'Atmos Mix' }))), ['4K']);
  assert.deepEqual(texts(src(audio('pcm_s24le'))), ['4K', 'LPCM']);
  assert.deepEqual(texts(src(audio('alac'))), ['4K', 'ALAC']);
  assert.deepEqual(texts(src(audio('dts', { profile: 'DTS-HD MA' }))), ['4K', 'DTS-HD MA']);
  assert.deepEqual(texts(src(audio('dts', { profile: 'DTS-ES Matrix' }))), ['4K']);
  assert.deepEqual(texts(src(audio('ac3'), 'DOVIInvalid', 'SDR')), ['4K'], 'DOVIInvalid ohne HDR: kein HDR-Tag');
  assert.deepEqual(texts(src(audio('ac3'), 'DOVIInvalid', 'HDR')), ['4K', 'HDR'], 'DOVIInvalid mit allgemeinem HDR: nur "HDR", kein Dolby Vision');
});

// ---------- Tags und ihre Reihenfolge (src/shared/media-tags.js; Faelle aus MediaTagTests.swift) ----------
const Tags = require('../src/shared/media-tags');
const vid = (o = {}) => ({ Index: 0, Type: 'Video', Codec: o.codec ?? 'hevc', Width: o.w ?? 3840, Height: o.h ?? 2160, VideoRange: o.range, VideoRangeType: o.rangeType });
const aud = (codec, o = {}) => ({ Index: o.index ?? 1, Type: 'Audio', Codec: codec, Channels: o.channels ?? 6, Profile: o.profile, AudioSpatialFormat: o.spatial, IsDefault: o.isDefault ?? true });
const src = (...streams) => ({ Id: 's', MediaStreams: streams });
const texts = (list) => list.map((t) => t.text);

test('Tags: Aufloesung 4K ist Premium, darunter gewoehnlich; ohne Groesse kein Tag', () => {
  for (const [w, h, text, premium] of [[3840, 2160, '4K', true], [3840, 1600, '4K', true], [1920, 1080, 'HD', false], [1920, 800, 'HD', false], [2560, 1440, '1440p', false], [1280, 720, '720p', false], [720, 576, 'SD', false]]) {
    const t = Tags.resolution(w, h);
    assert.equal(t.text, text);
    assert.equal(t.highlighted, premium, `${w}x${h}`);
    assert.equal(t.kind === 'uhd', premium);
  }
  assert.equal(Tags.resolution(null, null), null);
});

test('Tags: genau ein HDR-Format, das bestimmte vor dem allgemeinen; SDR ohne HDR-Tag', () => {
  for (const [rangeType, kind, text] of [['DOVI', 'dolbyVision', 'Dolby Vision'], ['DOVIWithHDR10', 'dolbyVision', 'Dolby Vision'], ['DOVIWithHDR10Plus', 'dolbyVision', 'Dolby Vision'], ['DOVIWithHLG', 'dolbyVision', 'Dolby Vision'], ['HDR10Plus', 'hdr10Plus', 'HDR10+'], ['HDR10', 'hdr10', 'HDR10'], ['HLG', 'hlg', 'HLG'], [undefined, 'hdr', 'HDR']]) {
    const hdr = Tags.source(src(vid({ range: 'HDR', rangeType }))).filter((t) => t.group === 'premiumVideo' && t.kind !== 'uhd');
    assert.deepEqual(hdr.map((t) => [t.kind, t.text]), [[kind, text]], String(rangeType));
  }
  const sdr = Tags.source(src(vid({ w: 1920, h: 1080, codec: 'h264', range: 'SDR', rangeType: 'SDR' }), aud('aac', { channels: 2 })));
  assert.deepEqual(texts(sdr), ['HD', 'H.264', 'AAC', 'Stereo']);
  assert.ok(sdr.every((t) => !t.highlighted));
});

test('Tags Detailseite: Premium-Aufloesung, HDR, Premium-Ton, dann Technik; nichts doppelt', () => {
  const film = src(vid({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), aud('truehd', { channels: 8, spatial: 'DolbyAtmos' }));
  const tags = Tags.source(film);
  assert.deepEqual(texts(tags), ['4K', 'Dolby Vision', 'Dolby Atmos', 'HEVC', '7.1']);
  assert.deepEqual(tags.map((t) => t.kind), ['uhd', 'dolbyVision', 'atmos', 'neutral', 'neutral']);
  for (const no of ['UHD', 'HDR', 'HDR10', 'TrueHD', 'Dolby TrueHD']) assert.ok(!texts(tags).includes(no), no);
});

test('Tags Detailseite: die Wiedergabe steht nach den Premium-Tags, vor der Technik; die gewaehlte Tonspur zaehlt', () => {
  const film = src(vid({ range: 'HDR', rangeType: 'HDR10' }), aud('dts', { channels: 6, profile: 'DTS-HD MA' }));
  assert.deepEqual(texts(Tags.source(film, { playback: 'DirectStream' })), ['4K', 'HDR10', 'DTS-HD MA', 'Direct Stream', 'HEVC', '5.1']);
  const plain = src(vid({ w: 1920, h: 1080, codec: 'h264' }), aud('ac3'));
  assert.deepEqual(texts(Tags.source(plain, { playback: 'DirectPlay' })), ['Direct Play', 'HD', 'H.264', 'AC3', '5.1']);
  assert.equal(Tags.source(plain, { playback: 'Transcode' })[0].kind, 'transcode');
  const multi = src(vid(), aud('truehd', { channels: 8, spatial: 'DolbyAtmos' }), aud('eac3', { index: 2, isDefault: false }), aud('aac', { channels: 2, index: 3, isDefault: false }));
  const tracks = multi.MediaStreams.filter((s) => s.Type === 'Audio');
  assert.deepEqual(texts(Tags.source(multi)), ['4K', 'Dolby Atmos', 'HEVC', '7.1']);
  assert.deepEqual(texts(Tags.source(multi, { audio: tracks[1] })), ['4K', 'HEVC', 'EAC3', '5.1']);
  assert.deepEqual(texts(Tags.source(multi, { audio: tracks[2] })), ['4K', 'HEVC', 'AAC', 'Stereo']);
  assert.deepEqual(texts(Tags.technical(src(aud('aac', { channels: 3 })), null, 'en')), ['AAC', '3 channels']);
});

test('Tags: hervorgehobene immer vor den gewoehnlichen; hoechstens 4K plus ein HDR-Format und ein Premium-Ton', () => {
  for (const streams of [[vid({ range: 'HDR', rangeType: 'HLG' }), aud('flac', { channels: 2 })], [vid({ w: 1920, h: 1080, range: 'HDR', rangeType: 'HDR10Plus' }), aud('pcm_s16le', { channels: 2 })], [vid({ w: 1280, h: 720, codec: 'av1' }), aud('dts', { channels: 8, profile: 'DTS-HD MA', spatial: 'DTSX' })]]) {
    const tags = Tags.source(src(...streams));
    const first = tags.findIndex((t) => !t.highlighted);
    assert.ok(first < 0 || tags.slice(first).every((t) => !t.highlighted), texts(tags).join(','));
    assert.ok(tags.filter((t) => t.group === 'premiumVideo').length <= 2);
    assert.ok(tags.filter((t) => t.group === 'premiumAudio').length <= 1);
  }
});

test('Tags Karten: 4K, HDR, Premium-Ton, dann HD; Kurzformen; ALAC wie FLAC', () => {
  const uhd = [vid({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), aud('truehd', { channels: 8, spatial: 'DolbyAtmos' })];
  assert.deepEqual(texts(Tags.card(uhd)), ['4K', 'Dolby Vision', 'Dolby Atmos']);
  assert.deepEqual(Tags.card(uhd).map((t) => t.short), ['4K', 'Dolby Vision', 'Atmos']);
  assert.deepEqual(texts(Tags.card([vid({ w: 1920, h: 1080, codec: 'h264' }), aud('truehd', { channels: 6 })])), ['Dolby TrueHD', 'HD']);
  assert.deepEqual(Tags.card([vid({ w: 1920, h: 1080, codec: 'h264' }), aud('truehd', { channels: 6 })]).map((t) => t.short), ['TrueHD', 'HD']);
  assert.deepEqual(texts(Tags.card([vid({ w: 1920, h: 1080, codec: 'h264' }), aud('aac', { channels: 2 })])), ['HD']);
  assert.deepEqual(Tags.card([vid({ w: 1280, h: 720, codec: 'h264' }), aud('aac', { channels: 2 })]), []);
  assert.deepEqual(Tags.card(null), []);
  assert.deepEqual(Tags.card([]), []);
  const alac = Tags.premiumAudio(aud('alac', { channels: 2 }));
  assert.deepEqual([alac.kind, alac.text], ['flac', 'ALAC']);
});

test('Tag-Farben: feste Tabelle, Flaeche dunkel und gleich hell, 4K mit fester Schrift und staerkerem Schein', () => {
  assert.deepEqual(Tags.STYLES.uhd, { start: '#ffae00', end: '#ffd700', fixedInk: '#fff0a3', glowBoost: 1.3 });
  assert.deepEqual([Tags.STYLES.dolbyVision.start, Tags.STYLES.dolbyVision.end], ['#8b5cf6', '#4f46e5']);
  assert.equal(Tags.paint('neutral'), null);
  for (const kind of Object.keys(Tags.STYLES)) {
    const p = Tags.paint(kind);
    assert.ok(Math.abs(Tags.luminance(p.fillStart) - 0.018) < 0.002, `${kind} links ${Tags.luminance(p.fillStart)}`);
    assert.ok(Math.abs(Tags.luminance(p.fillEnd) - 0.066) < 0.003, `${kind} rechts ${Tags.luminance(p.fillEnd)}`);
    if (kind !== 'uhd') assert.ok(Math.abs(Tags.luminance(p.ink) - 0.86) < 0.01, `${kind} Schrift`);
    // Lesbarkeit: mindestens 7:1 zur hellsten Stelle unter der Schrift ueber dunklem Grund, ueber weissem Bild noch 4,5:1
    for (const bg of ['#000000', '#08080a', '#0c1426']) assert.ok(Tags.contrast(p.ink, Tags.surfaceOver(kind, bg)) >= 7, `${kind} auf ${bg}: ${Tags.contrast(p.ink, Tags.surfaceOver(kind, bg)).toFixed(2)}`);
    assert.ok(Tags.contrast(p.ink, Tags.surfaceOver(kind, '#ffffff')) >= 4.5, `${kind} auf Weiss`);
  }
  assert.equal(Tags.paint('uhd').ink, '#fff0a3');
  assert.equal(Tags.paint('uhd').outlineStart, Tags.mix('#ffae00', '#ffffff', 0.14));
});

test('Tag-Staerke: ueberall voll, Wiedergabe-Tags nur auf der Seite ruhiger, 4K leuchtet 1,3-fach', () => {
  assert.deepEqual(Tags.emphasis('dolbyVision', 'image'), { glow: 0.6, outline: 0.95 });
  assert.deepEqual(Tags.emphasis('directPlay', 'dark'), { glow: 0.6, outline: 0.95 });
  const calm = Tags.emphasis('directPlay', 'page');
  assert.ok(Math.abs(calm.glow - 0.27) < 1e-9 && calm.outline === 0.7);
  assert.deepEqual(Tags.emphasis('hdr10', 'page'), { glow: 0.6, outline: 0.95 }, 'Formate der Datei leuchten auch auf der Seite voll');
  assert.ok(Math.abs(Tags.emphasis('uhd', 'image').glow - 0.78) < 1e-9);
});