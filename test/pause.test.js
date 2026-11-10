'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPauseInfo, logoUrl, plainText } = require('../src/main/pause-info');
const { DEFAULT_SETTINGS, deepMerge } = require('../src/main/config');

const ID = '0123456789abcdef0123456789abcdef';
const SERIES = 'fedcba9876543210fedcba9876543210';

const movie = {
  Id: ID,
  Type: 'Movie',
  Name: 'Aurora Protocol',
  ProductionYear: 2024,
  OfficialRating: 'PG-13',
  CommunityRating: 8.567,
  Overview: 'Eine Gruppe entdeckt ein Geheimnis.',
  Taglines: ['Manche Geschichten enden nie.'],
  Genres: ['Drama', 'Thriller', 'Science Fiction', 'Fantasy'],
  ImageTags: { Logo: 'abc123' }
};
const episode = {
  Id: ID,
  Type: 'Episode',
  Name: 'Der Anfang',
  SeriesName: 'Nordlicht',
  ParentIndexNumber: 2,
  IndexNumber: 5,
  Overview: 'Die Folge erzählt etwas.',
  ParentLogoItemId: SERIES,
  ParentLogoImageTag: 'tag9',
  UserData: { Played: false }
};

test('Pausenbildschirm: Film mit Logo, Angaben und Beschreibung', () => {
  const p = buildPauseInfo(movie);
  assert.equal(p.logo, `jellycloud://img/${ID}/Logo?maxWidth=800&quality=90&tag=abc123`);
  assert.equal(p.title, 'Aurora Protocol');
  assert.equal(p.isEpisode, false);
  assert.equal(p.year, 2024);
  assert.equal(p.rating, 'PG-13');
  assert.equal(p.score, 8.6, 'eine Nachkommastelle');
  assert.equal(p.overview, 'Eine Gruppe entdeckt ein Geheimnis.');
  assert.equal(p.tagline, 'Manche Geschichten enden nie.');
  assert.deepEqual(p.genres, ['Drama', 'Thriller', 'Science Fiction'], 'höchstens drei Genres');
  assert.equal(p.season, null);
  assert.equal(p.episode, null);
});

test('Pausenbildschirm: Folge zeigt Serientitel, Staffel, Folge und das Logo der Serie', () => {
  const p = buildPauseInfo(episode);
  assert.equal(p.title, 'Nordlicht');
  assert.equal(p.isEpisode, true);
  assert.equal(p.season, 2);
  assert.equal(p.episode, 5);
  assert.equal(p.episodeName, 'Der Anfang');
  assert.equal(p.logo, `jellycloud://img/${SERIES}/Logo?maxWidth=800&quality=90&tag=tag9`, 'Logo der Serie');
  assert.equal(p.tagline, '', 'Folgen haben keinen Werbespruch');
  assert.equal(p.overview, 'Die Folge erzählt etwas.');
});

test('Pausenbildschirm: Spoiler-Schutz lässt die Beschreibung ungesehener Folgen weg, gesehene und Filme nicht', () => {
  assert.equal(buildPauseInfo(episode, { spoilerProtection: true }).overview, '');
  assert.equal(buildPauseInfo({ ...episode, UserData: { Played: true } }, { spoilerProtection: true }).overview, 'Die Folge erzählt etwas.');
  assert.equal(buildPauseInfo(movie, { spoilerProtection: true }).overview, 'Eine Gruppe entdeckt ein Geheimnis.');
  assert.equal(buildPauseInfo(episode, { spoilerProtection: false }).overview, 'Die Folge erzählt etwas.');
});

test('Pausenbildschirm: fehlende Angaben ergeben leere Felder statt Fehler', () => {
  const p = buildPauseInfo({ Id: ID, Type: 'Movie', Name: 'Nur ein Name' });
  assert.equal(p.logo, null);
  assert.equal(p.year, null);
  assert.equal(p.rating, '');
  assert.equal(p.score, null);
  assert.equal(p.overview, '');
  assert.deepEqual(p.genres, []);
  assert.equal(buildPauseInfo({ Id: ID, Type: 'Movie', Name: 'x', CommunityRating: 0 }).score, null, 'Bewertung 0 heißt: keine');
  assert.equal(buildPauseInfo({ Id: ID, Type: 'Movie', Name: 'x', CommunityRating: 'viel' }).score, null);
  assert.equal(buildPauseInfo({ Id: ID, Type: 'Movie', Name: 'x', Genres: [1, null, '', ' ', 'Drama'] }).genres[0], 'Drama');
});

test('Pausenbildschirm: Logo nur mit Kennung, Parent-Logo nur vollständig', () => {
  assert.equal(logoUrl({ Id: ID, ImageTags: {} }), null);
  assert.equal(logoUrl({ Id: ID, ParentLogoItemId: SERIES }), null, 'ohne Tag der Serie kein Logo');
  assert.equal(logoUrl({ Id: ID, ImageTags: { Logo: 'a b&c' } }), `jellycloud://img/${ID}/Logo?maxWidth=800&quality=90&tag=a+b%26c`, 'Tag wird maskiert, nichts rutscht in die Adresse');
});

test('Beschreibung wird zu reinem Text: Umbrüche bleiben, Auszeichnung fällt weg, Länge begrenzt', () => {
  assert.equal(plainText('Zeile eins<br>Zeile zwei<br/>Drei'), 'Zeile eins\nZeile zwei\nDrei');
  assert.equal(plainText('<b>Fett</b> und <script>alert(1)</script>normal'), 'Fett und alert(1)normal');
  assert.equal(plainText('  viel     Platz  '), 'viel Platz');
  assert.equal(plainText('a\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(plainText('x'.repeat(5000)).length, 1200);
  assert.equal(plainText(undefined), '');
});

test('Pausenbildschirm: Einstellungen haben Standardwerte (an, 6 s), alte Konfigurationen bekommen sie ergänzt', () => {
  assert.equal(DEFAULT_SETTINGS.player.pauseScreen, true);
  assert.equal(DEFAULT_SETTINGS.player.pauseScreenSec, 6);
  const merged = deepMerge(DEFAULT_SETTINGS, { player: { volume: 50 } });
  assert.equal(merged.player.pauseScreen, true);
  assert.equal(merged.player.pauseScreenSec, 6);
  assert.equal(deepMerge(DEFAULT_SETTINGS, { player: { pauseScreen: false, pauseScreenSec: 10 } }).player.pauseScreenSec, 10);
});

test('Hilfen des Overlays: Dauer, Ende, Kapitel', async () => {
  const { formatSpan, formatClock, endsAt, chapterAt, isGenericChapter } = await import('../src/player/pause.js');
  assert.equal(formatSpan(0), 'weniger als 1 Min.');
  assert.equal(formatSpan(29), 'weniger als 1 Min.');
  assert.equal(formatSpan(31), '1 Min.');
  assert.equal(formatSpan(53 * 60), '53 Min.');
  assert.equal(formatSpan(3600), '1 Std.');
  assert.equal(formatSpan(72 * 60), '1 Std. 12 Min.');
  assert.equal(formatSpan(95 * 60, 'en'), '1 h 35 min');
  assert.equal(formatSpan(5 * 60, 'en'), '5 min');
  assert.equal(formatSpan(undefined), 'weniger als 1 Min.');
  assert.equal(formatClock(new Date(2026, 10, 4, 22, 41), 'de'), '22:41');
  assert.equal(formatClock(new Date(2026, 10, 4, 7, 5), 'de'), '07:05');
  assert.match(formatClock(new Date(2026, 10, 4, 22, 41), 'en'), /^10:41\s?PM$/);

  const now = Date.UTC(2026, 10, 4, 20, 0, 0);
  const e = endsAt(now, 6000, 600);
  assert.equal(e.left, 5400);
  assert.equal(e.at.getTime(), now + 5400_000);
  assert.equal(endsAt(now, 6000, 600, 2).left, 2700, 'doppelte Geschwindigkeit halbiert den Rest');
  assert.equal(endsAt(now, 6000, 7000).left, 0, 'nie negativ');
  assert.equal(endsAt(now, 6000, 600, 0).left, 5400, 'Geschwindigkeit 0 wird wie 1 behandelt');

  const chapters = [{ time: 0, title: 'Kapitel 1' }, { time: 700, title: 'Die Flucht' }, { time: 1400, title: 'Kapitel 3' }];
  assert.deepEqual(chapterAt(chapters, 0), { n: 1, title: 'Kapitel 1' });
  assert.deepEqual(chapterAt(chapters, 700), { n: 2, title: 'Die Flucht' });
  assert.deepEqual(chapterAt(chapters, 1399), { n: 2, title: 'Die Flucht' });
  assert.deepEqual(chapterAt(chapters, 5000), { n: 3, title: 'Kapitel 3' });
  assert.equal(chapterAt([{ time: 0, title: 'Einziges' }], 10), null, 'ein einzelnes Kapitel sagt nichts');
  assert.equal(chapterAt([], 10), null);
  assert.equal(chapterAt(undefined, 10), null);
  assert.equal(isGenericChapter('Kapitel 3'), true);
  assert.equal(isGenericChapter('chapter 12'), true);
  assert.equal(isGenericChapter('Die Flucht'), false);
  assert.equal(isGenericChapter(''), true);
});
