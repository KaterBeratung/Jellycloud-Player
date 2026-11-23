'use strict';
/**
 * Informationsblock der Detailseite (src/shared/detail-facts.js): Gruppen und Zeilen wie DetailView+Information.swift der Apple-App, Namen der Spuren wie
 * TrackLabel (Design/Format.swift), dazu Groesse und Container der Datei.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const DF = require('../src/shared/detail-facts');

const GiB = 1024 ** 3;
const source = (o = {}) => ({
  Id: 'src1',
  Name: 'Kinofassung',
  Container: 'mkv',
  Size: 4.5 * GiB,
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: 'DOVIWithHDR10' },
    { Type: 'Audio', Index: 1, Codec: 'truehd', Channels: 8, Language: 'eng' },
    { Type: 'Audio', Index: 2, Codec: 'eac3', Channels: 6, Language: 'ger' },
    { Type: 'Audio', Index: 3, Codec: 'aac', Channels: 2, Title: 'SoundHandler' },
    { Type: 'Subtitle', Index: 4, Codec: 'subrip', Language: 'ger' },
    { Type: 'Subtitle', Index: 5, Codec: 'pgssub', Language: 'ger', IsForced: true },
    { Type: 'Subtitle', Index: 6, Codec: 'subrip', Language: 'eng' },
    { Type: 'Subtitle', Index: 7, Codec: 'subrip', Title: 'Kommentar' }
  ],
  ...o
});
const movie = (o = {}) => ({ Type: 'Movie', Name: 'Film', Genres: ['Drama', 'Krimi', 'Thriller', 'Mystery'], PremiereDate: '2021-03-12T00:00:00.0000000Z', ProductionYear: 2021, RunTimeTicks: 130 * 60 * 1e7, OfficialRating: 'FSK 12', Studios: [{ Name: 'Nordlicht' }], MediaSources: [source()], ...o });
const rows = (groups, title) => Object.fromEntries((groups.find((g) => g.title === title)?.rows ?? []).map((r) => [r.label, r.value]));

test('Allgemein: Genre (hoechstens drei), Erschienen (Datum, sonst Jahr), Laufzeit, Freigabe, Studio', () => {
  const g = DF.informationGroups(movie(), { source: source() });
  assert.deepEqual(g.map((x) => x.title), ['Allgemein', 'Sprachen', 'Datei']);
  assert.deepEqual(rows(g, 'Allgemein'), { Genre: 'Drama, Krimi, Thriller', Erschienen: '12. März 2021', Laufzeit: '2 Std. 10 Min.', Freigabe: 'FSK 12', Studio: 'Nordlicht' });
  assert.equal(rows(DF.informationGroups(movie({ PremiereDate: null }), {}), 'Allgemein').Erschienen, '2021', 'ohne Datum das Jahr');
  assert.equal(rows(DF.informationGroups(movie({ PremiereDate: '2021-03-12T23:30:00Z' }), {}), 'Allgemein').Erschienen, '12. März 2021', 'der Tag des Servers, nicht der der Zeitzone');
});

test('Sprachen: je Tonspur eine Zeile (Sprache, Format, Kanaele); Untertitel als Sprachen, jede einmal', () => {
  const l = rows(DF.informationGroups(movie(), { source: source() }), 'Sprachen');
  assert.equal(l.Ton, 'Englisch · Dolby TrueHD · 7.1\nDeutsch · Dolby Digital Plus · 5.1\nTon 3 · AAC · Stereo', 'ohne Sprache und mit dem Namen eines Programms als Titel: "Ton 3" (gezaehlt unter den Tonspuren)');
  assert.equal(l.Untertitel, 'Deutsch, Englisch, Kommentar', 'Deutsch nur einmal, ohne Sprache der Titel');
});

test('Datei: Version nur bei mehreren, Video, Container und Groesse, die Wiedergabe von Anfang an', () => {
  const one = rows(DF.informationGroups(movie(), { source: source() }), 'Datei');
  assert.deepEqual(one, { Video: 'HEVC · 4K · Dolby Vision', Datei: 'MKV · 4,50 GB', Wiedergabe: 'Wird ermittelt …' });
  const two = movie({ MediaSources: [source(), source({ Id: 'src2', Name: 'Director’s Cut' })] });
  assert.equal(rows(DF.informationGroups(two, { source: two.MediaSources[1] }), 'Datei').Version, 'Director’s Cut');
  assert.equal(rows(DF.informationGroups(movie(), { source: source(), playback: { method: 'DirectPlay' } }), 'Datei').Wiedergabe, 'Direct Play');
  assert.equal(rows(DF.informationGroups(movie(), { source: source(), playback: { method: 'Transcode' } }), 'Datei').Wiedergabe, 'Transcoding');
  assert.equal(rows(DF.informationGroups(movie(), { source: source(), playback: { failed: true } }), 'Datei').Wiedergabe, 'Nicht ermittelt');
  assert.equal(rows(DF.informationGroups(movie(), { source: source({ Container: 'mov,mp4,m4a,3gp,3g2,mj2' }) }), 'Datei').Datei, 'MP4 · 4,50 GB', 'Jellyfin nennt fuer MP4 eine Liste');
});

test('Serie: nur Allgemein (keine Datei, keine Wiedergabe); leere Gruppen entfallen', () => {
  const g = DF.informationGroups({ Type: 'Series', Genres: ['Drama'], ProductionYear: 2019 }, { source: null });
  assert.deepEqual(g, [{ title: 'Allgemein', rows: [{ label: 'Genre', value: 'Drama' }, { label: 'Erschienen', value: '2019' }] }]);
  assert.deepEqual(DF.informationGroups({ Type: 'Movie' }, {}), [], 'nichts bekannt: kein Block');
  assert.deepEqual(DF.informationGroups(null), []);
  const noPlayback = rows(DF.informationGroups({ Type: 'Series' }, { source: source() }), 'Datei');
  assert.equal(noPlayback.Wiedergabe, undefined, 'Wiedergabe nur bei Filmen und Folgen');
});

test('Englisch', () => {
  const g = DF.informationGroups(movie(), { source: source(), playback: { method: 'DirectStream' }, lang: 'en' });
  assert.deepEqual(g.map((x) => x.title), ['General', 'Languages', 'File']);
  assert.equal(rows(g, 'General').Released, 'March 12, 2021');
  assert.equal(rows(g, 'Languages').Audio.split('\n')[0], 'English · Dolby TrueHD · 7.1');
  assert.equal(rows(g, 'File').File, 'MKV · 4.50 GB');
  assert.equal(rows(g, 'File').Playback, 'Direct Stream');
});

test('Spuren: Sprache, sonst ein Titel, der etwas sagt, sonst gezaehlt; Kanaele in Worten', () => {
  const tracks = [{ Index: 4, Type: 'Audio' }, { Index: 9, Type: 'Audio', Title: 'GPAC ISO Audio Handler' }];
  assert.equal(DF.trackName(tracks[1], 'Audio', tracks), 'Ton 2');
  assert.equal(DF.trackName({ Index: 2, Language: 'jpn' }, 'Subtitle', []), 'Japanisch');
  assert.equal(DF.trackName({ Index: 2, Language: 'und', Title: 'Signs & Songs' }, 'Subtitle', []), 'Signs & Songs');
  assert.equal(DF.trackName({ Index: 2 }, 'Subtitle', [{ Index: 2 }], 'en'), 'Subtitles 1');
  assert.deepEqual(DF.audioDetails({ Codec: 'ac3', Channels: 1 }), ['Dolby Digital', 'Mono']);
  assert.deepEqual(DF.audioDetails({ Codec: 'dts', Profile: 'DTS-HD MA', Channels: 4 }), ['DTS-HD MA', '4 Kanäle']);
  assert.deepEqual(DF.audioDetails({ Codec: 'flac', Channels: 4 }, 'en'), ['FLAC', '4 channels']);
});

test('Groesse in der Einheit des Explorers, Dezimalzeichen der Sprache; Container', () => {
  assert.equal(DF.size(4.5 * GiB), '4,50 GB');
  assert.equal(DF.size(15 * GiB), '15,0 GB');
  assert.equal(DF.size(700 * 1024 ** 2), '700 MB');
  assert.equal(DF.size(2048), '2 KB');
  assert.equal(DF.size(10), '1 KB');
  assert.equal(DF.size(4.5 * GiB, 'en'), '4.50 GB');
  assert.equal(DF.size(0), null);
  assert.equal(DF.size(null), null);
  assert.equal(DF.containerName('matroska,webm'), 'MKV');
  assert.equal(DF.containerName('avi'), 'AVI');
  assert.equal(DF.containerName(''), null);
});
