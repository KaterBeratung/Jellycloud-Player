'use strict';

// Geraeteprofil der Android-App (src/shared/android-profile.js): aus den Decodern des Geraets, damit der Server im Heimnetz nichts unnoetig umwandelt
// und beim Umwandeln HEVC statt nur H.264 liefern bzw. das HEVC-Bild unveraendert lassen darf.
const test = require('node:test');
const assert = require('node:assert/strict');
const Profile = require('../src/shared/android-profile');

const PHONE = {
  video: {
    h264: { maxWidth: 4096, maxHeight: 2304, tenBit: false, hardware: true },
    hevc: { maxWidth: 4096, maxHeight: 2304, tenBit: true, hardware: true },
    vp9: { maxWidth: 4096, maxHeight: 2304, tenBit: true, hardware: true },
    vp8: { maxWidth: 1920, maxHeight: 1080, tenBit: false, hardware: false },
    av1: { maxWidth: 2048, maxHeight: 2048, tenBit: true, hardware: false }
  },
  audio: { ac3: true, eac3: true },
  passthrough: {},
  dolbyVision: false
};

const direct = (p) => p.DirectPlayProfiles[0];
const hls = (p) => p.TranscodingProfiles[0];
const codecProfile = (p, codec) => p.CodecProfiles.find((c) => c.Codec === codec);
const cond = (cp, prop) => cp?.Conditions.find((c) => c.Property === prop);

test('Umwandeln: HEVC zuerst, wenn das Geraet HEVC kann (vorher nur H.264)', () => {
  const p = Profile.build({ maxBitrate: 400e6, audioChannels: 6, caps: PHONE });
  assert.equal(hls(p).VideoCodec, 'hevc,h264');
  assert.equal(hls(p).Container, 'ts');
  assert.equal(hls(p).MaxAudioChannels, '6');
  // AC3/E-AC3 kann das Geraet: beim Umwandeln des Bildes bleibt der Ton unveraendert
  assert.equal(hls(p).AudioCodec, 'aac,mp3,ac3,eac3');
});

test('Ohne HEVC-Decoder bleibt beim Umwandeln nur H.264', () => {
  const caps = { ...PHONE, video: { h264: PHONE.video.h264 } };
  const p = Profile.build({ maxBitrate: 400e6, caps });
  assert.equal(hls(p).VideoCodec, 'h264');
  assert.equal(direct(p).VideoCodec, 'h264');
});

test('Direct Play: Ton mit Decoder des Systems oder Durchleitung, sonst nur der Grundbestand', () => {
  const p = Profile.build({ maxBitrate: 400e6, caps: PHONE });
  assert.deepEqual(direct(p).AudioCodec.split(','), ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'ac3', 'eac3']);
  const tv = Profile.build({ maxBitrate: 400e6, caps: { ...PHONE, audio: {}, passthrough: { ac3: true, eac3: true, dts: true, truehd: true } } });
  assert.deepEqual(direct(tv).AudioCodec.split(','), ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'ac3', 'eac3', 'dts', 'truehd']);
  const plain = Profile.build({ maxBitrate: 400e6, caps: { ...PHONE, audio: {} } });
  assert.equal(direct(plain).AudioCodec, 'aac,mp3,opus,flac,vorbis');
  assert.equal(hls(plain).AudioCodec, 'aac,mp3');
});

test('Direct Play: Container von Media3, AV1 nur mit Decoder in der Hardware', () => {
  const p = Profile.build({ maxBitrate: 400e6, caps: PHONE });
  assert.equal(direct(p).Container, 'mp4,m4v,mov,mkv,webm,ts,mpegts,avi');
  assert.deepEqual(direct(p).VideoCodec.split(','), ['h264', 'hevc', 'vp9', 'vp8']);
  const hw = Profile.build({ maxBitrate: 400e6, caps: { ...PHONE, video: { ...PHONE.video, av1: { ...PHONE.video.av1, hardware: true } } } });
  assert.ok(direct(hw).VideoCodec.split(',').includes('av1'));
});

test('Grenzen: Bildgroesse des Decoders, 10 Bit nur mit Main 10, H.264 nie mit 10 Bit', () => {
  const p = Profile.build({ maxBitrate: 400e6, caps: PHONE });
  assert.equal(cond(codecProfile(p, 'hevc'), 'Width').Value, '4096');
  assert.equal(cond(codecProfile(p, 'hevc'), 'Height').Value, '2304');
  assert.equal(cond(codecProfile(p, 'hevc'), 'VideoBitDepth'), undefined);
  assert.equal(cond(codecProfile(p, 'h264'), 'VideoBitDepth').Value, '8');
  const old = Profile.build({ maxBitrate: 400e6, caps: { ...PHONE, video: { ...PHONE.video, hevc: { ...PHONE.video.hevc, tenBit: false } } } });
  assert.equal(cond(codecProfile(old, 'hevc'), 'VideoBitDepth').Value, '8');
  // Alle Bedingungen sind nicht zwingend: fehlt dem Server die Angabe, laeuft die Datei unveraendert
  for (const cp of p.CodecProfiles) for (const c of cp.Conditions) assert.equal(c.IsRequired, false);
});

test('Dolby Vision Profil 5 nur mit DV-Decoder unveraendert', () => {
  const p = Profile.build({ maxBitrate: 400e6, caps: PHONE });
  assert.deepEqual(cond(codecProfile(p, 'hevc'), 'VideoRangeType'), { Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVI', IsRequired: false });
  const dv = Profile.build({ maxBitrate: 400e6, caps: { ...PHONE, dolbyVision: true } });
  assert.equal(cond(codecProfile(dv, 'hevc'), 'VideoRangeType'), undefined);
});

test('Ohne Angaben des Geraets: H.264, HEVC (10 Bit), VP8/VP9 und der Grundbestand an Ton', () => {
  for (const caps of [null, undefined, {}, { video: {} }, 'x']) {
    const p = Profile.build({ maxBitrate: 400e6, caps });
    assert.deepEqual(direct(p).VideoCodec.split(','), ['h264', 'hevc', 'vp9', 'vp8']);
    assert.equal(direct(p).AudioCodec, 'aac,mp3,opus,flac,vorbis');
    assert.equal(hls(p).VideoCodec, 'hevc,h264');
    assert.equal(cond(codecProfile(p, 'hevc'), 'VideoBitDepth'), undefined);
  }
});

test('Rueckfall nach Fehler des Decoders: nur H.264 und AAC', () => {
  const p = Profile.build({ maxBitrate: 400e6, caps: PHONE, fallback: true });
  assert.equal(hls(p).VideoCodec, 'h264');
  assert.equal(hls(p).AudioCodec, 'aac');
});

test('Bitraten und Untertitel', () => {
  const p = Profile.build({ maxBitrate: 20e6, caps: PHONE, staticFloor: 400e6 });
  assert.equal(p.MaxStreamingBitrate, 20e6);
  assert.equal(p.MaxStaticBitrate, 400e6);
  const embed = p.SubtitleProfiles.filter((s) => s.Method === 'Embed').map((s) => s.Format);
  for (const f of ['pgssub', 'dvdsub', 'dvbsub', 'ass', 'srt', 'mov_text']) assert.ok(embed.includes(f), f);
  const external = p.SubtitleProfiles.filter((s) => s.Method === 'External').map((s) => s.Format);
  assert.deepEqual(external, ['srt', 'subrip', 'vtt', 'webvtt', 'ass', 'ssa']);
});
