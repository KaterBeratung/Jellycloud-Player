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
