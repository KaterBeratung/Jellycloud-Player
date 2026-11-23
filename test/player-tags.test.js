'use strict';
// Tags des Players (Plan P22, Y10; src/shared/media-tags.js player, delivery, keepsAudio): Faelle aus MediaTagTests der Apple-App (Abschnitt "Player").
// Nicht uebernommen: die Herleitung von Direct Stream oder Transcoding aus den Gruenden des Servers (PlaybackOutlook); unter Windows und Android nennt
// das der Server selbst (SupportsDirectStream, resolvePlayback.method).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/shared/media-tags');

const video = ({ width = 3840, height = 2160, codec = 'hevc', range = 'SDR', rangeType = 'SDR' } = {}) => ({ Index: 0, Type: 'Video', Width: width, Height: height, Codec: codec, VideoRange: range, VideoRangeType: rangeType });
const audio = (codec, { channels = 6, spatial, profile, kbps, index = 1 } = {}) => ({ Index: index, Type: 'Audio', Codec: codec, Channels: channels, AudioSpatialFormat: spatial, Profile: profile, BitRate: kbps ? kbps * 1000 : undefined });
const source = (streams) => ({ Id: 's', MediaStreams: streams });
const hls = (q) => `http://server/videos/f/master.m3u8?${q}`;
const texts = (tags) => tags.map((t) => t.text);
const tags = (film, method, { query, audioIndex = 1, hdr = true, presented = null, outputChannels } = {}) =>
  T.player({ source: film, audio: film.MediaStreams.find((s) => s.Type === 'Audio' && s.Index === audioIndex), delivery: T.delivery(method, query ? hls(query) : null, outputChannels), hdrOutput: hdr, presented });

test('Direct Play: Wiedergabestatus zuerst, dann die Formate der Datei', () => {
  const film = source([video({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), audio('eac3', { spatial: 'DolbyAtmos' })]);
  const t = tags(film, 'DirectPlay');
  assert.deepEqual(texts(t), ['Direct Play', '4K', 'Dolby Vision', 'Dolby Atmos', '5.1', 'HEVC']);
  assert.equal(t[0].kind, 'directPlay');
});

test('HDR steht nur da, wenn das Geraet HDR ausgibt', () => {
  const film = source([video({ range: 'HDR', rangeType: 'HDR10' }), audio('ac3')]);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { hdr: true })), ['Direct Play', '4K', 'HDR10', 'AC3', '5.1', 'HEVC']);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { hdr: false })), ['Direct Play', '4K', 'AC3', '5.1', 'HEVC']);
});

test('Direct Stream mit gewandeltem Ton: das Bild bleibt, der Ton ist das Zielformat, nicht die Originalspur', () => {
  const film = source([video({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), audio('truehd', { channels: 8, spatial: 'DolbyAtmos', kbps: 4200 })]);
  const t = tags(film, 'DirectStream', { query: 'VideoCodec=hevc,h264&AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6&TranscodeReasons=AudioCodecNotSupported' });
  assert.deepEqual(texts(t), ['Direct Stream', '4K', 'Dolby Vision', 'AAC', '5.1', 'HEVC']);
  assert.ok(t.every((x) => x.group !== 'premiumAudio'), 'weder Atmos noch TrueHD: beides kommt nicht an');
});

test('Direct Stream nur neu verpackt: eine erlaubte Tonspur kommt unveraendert an', () => {
  const film = source([video({ range: 'HDR', rangeType: 'HDR10' }), audio('eac3', { spatial: 'DolbyAtmos', kbps: 768 })]);
  const t = tags(film, 'DirectStream', { query: 'VideoCodec=hevc,h264&AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6&AudioBitrate=768000&TranscodeReasons=ContainerNotSupported' });
  assert.deepEqual(texts(t), ['Direct Stream', '4K', 'HDR10', 'Dolby Atmos', '5.1', 'HEVC']);
});

test('Eine Tonspur ueber den Grenzen des Stroms gilt als gewandelt (Kanaele, Datenrate, genannter Grund); ohne Codec-Angabe im Zweifel gewandelt', () => {
  const wide = audio('eac3', { channels: 8, spatial: 'DolbyAtmos', kbps: 768 });
  const heavy = audio('eac3', { channels: 6, spatial: 'DolbyAtmos', kbps: 1536 });
  const fine = audio('eac3', { channels: 6, spatial: 'DolbyAtmos', kbps: 640 });
  const d = T.delivery('DirectStream', hls('AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6&AudioBitrate=768000'));
  assert.deepEqual([T.keepsAudio(d, wide), T.keepsAudio(d, heavy), T.keepsAudio(d, fine)], [false, false, true]);
  assert.equal(T.keepsAudio(T.delivery('DirectStream', hls('AudioCodec=aac,ac3,eac3&TranscodeReasons=ContainerNotSupported,AudioChannelsNotSupported')), fine), false);
  assert.equal(T.keepsAudio(T.delivery('DirectStream', hls('TranscodeReasons=ContainerNotSupported')), fine), false);
  assert.equal(T.keepsAudio(T.delivery('DirectPlay'), wide), true);
  const unknown = { ...audio('eac3', { kbps: 640 }), Channels: undefined };
  assert.equal(T.keepsAudio(T.delivery('DirectStream', hls('AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6')), unknown), false, 'Kanalzahl unbekannt bei einer Grenze');
  assert.equal(T.keepsAudio(T.delivery('DirectStream', hls('AudioCodec=aac,ac3,eac3')), unknown), true);
});

test('Transcoding: kein HDR-Tag, Zielcodecs, und die Aufloesung nur, wenn der Player sie meldet', () => {
  const film = source([video({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), audio('truehd', { channels: 8, spatial: 'DolbyAtmos' })]);
  const query = 'VideoCodec=h264&AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6&VideoBitrate=7616000&AudioBitrate=384000&TranscodeReasons=ContainerBitrateExceedsLimit';
  assert.deepEqual(texts(tags(film, 'Transcode', { query })), ['Transcoding', 'AAC', '5.1', 'H.264']);
  assert.deepEqual(texts(tags(film, 'Transcode', { query, presented: { width: 1920, height: 1080 } })), ['Transcoding', 'HD', 'AAC', '5.1', 'H.264']);
  assert.deepEqual(texts(tags(film, 'Transcode', { query, presented: { width: 3840, height: 2160 } })), ['Transcoding', '4K', 'AAC', '5.1', 'H.264']);
  const open = query.replace('VideoCodec=h264', 'VideoCodec=hevc,h264');
  assert.deepEqual(texts(tags(film, 'Transcode', { query: open, presented: { width: 1920, height: 1080 } })), ['Transcoding', 'HD', 'AAC', '5.1'], 'mehrere Bildcodecs: der Server waehlt, keiner steht da');
});

test('Verlustfrei gewandelter Ton (FLAC) bleibt hervorgehoben, ohne Atmos zu behaupten', () => {
  const film = source([video({ width: 1920, height: 1080 }), audio('truehd', { channels: 8, spatial: 'DolbyAtmos' })]);
  const t = tags(film, 'DirectStream', { query: 'VideoCodec=hevc,h264&AudioCodec=flac,aac,ac3,eac3&TranscodingMaxAudioChannels=8&TranscodeReasons=AudioCodecNotSupported' });
  assert.deepEqual(texts(t), ['Direct Stream', 'HD', 'FLAC', '7.1', 'HEVC']);
  assert.ok(!t.some((x) => x.kind === 'atmos' || x.kind === 'trueHD'));
});

test('Die gemeldete Bildgroesse hat Vorrang vor der Datei', () => {
  const film = source([video({ width: 1920, height: 1080, codec: 'h264' }), audio('aac', { channels: 2 })]);
  assert.deepEqual(texts(tags(film, 'DirectPlay')), ['Direct Play', 'HD', 'AAC', 'Stereo', 'H.264']);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { presented: { width: 1280, height: 720 } })), ['Direct Play', '720p', 'AAC', 'Stereo', 'H.264']);
});

test('Rangfolge des Nutzers: Wiedergabe, Aufloesung, HDR, Ton mit Kanaelen, weitere Technik', () => {
  const film = source([video({ range: 'HDR', rangeType: 'HLG' }), audio('flac', { channels: 2 })]);
  for (const method of ['DirectPlay', 'DirectStream', 'Transcode']) {
    const t = tags(film, method, { query: method === 'DirectPlay' ? undefined : 'VideoCodec=hevc&AudioCodec=aac', presented: { width: 3840, height: 2160 } });
    assert.equal(t[0].group, 'playback', method);
    assert.equal(t.filter((x) => x.group === 'playback').length, 1);
    assert.equal(t[1].text, '4K', `${method}: Aufloesung an zweiter Stelle`);
  }
  const plain = source([video({ width: 1920, height: 1080, codec: 'h264' }), audio('truehd', { channels: 6 })]);
  assert.deepEqual(texts(tags(plain, 'DirectPlay')), ['Direct Play', 'HD', 'Dolby TrueHD', '5.1', 'H.264']);
});

test('Eine HDR-Datei, neu verpackt an eine Ausgabe ohne HDR, laeuft als umgerechnete Fassung: Transcoding, kein HDR, kein Bildcodec der Datei', () => {
  const film = source([video({ range: 'HDR', rangeType: 'DOVIWithHDR10' }), audio('eac3', { kbps: 640 })]);
  const query = 'VideoCodec=hevc,h264&AudioCodec=aac,ac3,eac3&TranscodingMaxAudioChannels=6&TranscodeReasons=ContainerNotSupported';
  assert.deepEqual(texts(tags(film, 'DirectStream', { query, hdr: true })), ['Direct Stream', '4K', 'Dolby Vision', 'EAC3', '5.1', 'HEVC']);
  assert.deepEqual(texts(tags(film, 'DirectStream', { query, hdr: false, presented: { width: 3840, height: 2160 } })), ['Transcoding', '4K', 'EAC3', '5.1']);
  const sdr = source([video({ width: 1920, height: 1080 }), audio('eac3', { kbps: 640 })]);
  assert.deepEqual(texts(tags(sdr, 'DirectStream', { query, hdr: false })), ['Direct Stream', 'HD', 'EAC3', '5.1', 'HEVC']);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { hdr: false })), ['Direct Play', '4K', 'EAC3', '5.1', 'HEVC']);
});

test('Dolby Vision mit Erweiterungsschicht (Profil 7) laeuft im Player als HDR10', () => {
  const hdrKinds = ['dolbyVision', 'hdr10Plus', 'hdr10', 'hdr', 'hlg'];
  for (const [rangeType, range, played] of [['DOVIWithEL', 'HDR', 'HDR10'], ['DOVIWithELHDR10Plus', 'HDR', 'HDR10'], ['DOVIWithHDR10', 'HDR', 'Dolby Vision'], ['DOVIInvalid', 'SDR', '']]) {
    const film = source([video({ range, rangeType }), audio('ac3')]);
    assert.deepEqual(texts(tags(film, 'DirectPlay').filter((x) => hdrKinds.includes(x.kind))), played ? [played] : [], rangeType);
  }
});

test('Die gewaehlte Tonspur und die Kanalgrenze der Anfrage gelten, wenn die Adresse keine nennt', () => {
  const film = source([video({ range: 'HDR', rangeType: 'HDR10' }), audio('truehd', { channels: 8, spatial: 'DolbyAtmos' }), audio('eac3', { channels: 6, kbps: 640, index: 2 })]);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { audioIndex: 2 })), ['Direct Play', '4K', 'HDR10', 'EAC3', '5.1', 'HEVC']);
  assert.deepEqual(texts(tags(film, 'DirectPlay', { audioIndex: 1 })), ['Direct Play', '4K', 'HDR10', 'Dolby Atmos', '7.1', 'HEVC']);
  const d = T.delivery('DirectStream', hls('VideoCodec=hevc,h264&AudioCodec=aac,ac3,eac3&TranscodeReasons=AudioCodecNotSupported'), 2);
  assert.equal(d.maxChannels, 2, 'Stereo-Ausgabe: der Server mischt auf 2 Kanaele');
  assert.deepEqual(texts(tags(film, 'DirectStream', { query: 'VideoCodec=hevc,h264&AudioCodec=aac,ac3,eac3&TranscodeReasons=AudioCodecNotSupported', outputChannels: 2 })), ['Direct Stream', '4K', 'HDR10', 'AAC', 'Stereo', 'HEVC']);
  assert.equal(T.delivery('Transcode', hls('VideoCodec=h264&TranscodingMaxAudioChannels=6'), 8).maxChannels, 6, 'die Adresse geht vor');
});
