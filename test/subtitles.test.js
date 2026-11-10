const test = require('node:test');
const assert = require('node:assert/strict');
const { langCode, subtitleKind, groupByLanguage } = require('../src/shared/media');

const sub = (Index, Language, extra = {}) => ({ Index, Type: 'Subtitle', Language, Codec: 'subrip', ...extra });

test('Sprachcodes: ISO-639-2 und -1 ergeben denselben Kurzcode, Unbekanntes bleibt, ohne Angabe "und"', () => {
  assert.equal(langCode('ger'), 'de');
  assert.equal(langCode('deu'), 'de');
  assert.equal(langCode('DE'), 'de');
  assert.equal(langCode('eng'), 'en');
  assert.equal(langCode('fre'), 'fr');
  assert.equal(langCode('xyz'), 'xyz');
  assert.equal(langCode(''), 'und');
  assert.equal(langCode(undefined), 'und');
  assert.equal(langCode('und'), 'und');
});

test('Art einer Untertitelspur: normal, erzwungen, fuer Hoergeschaedigte', () => {
  assert.equal(subtitleKind(sub(1, 'ger')), 'full');
  assert.equal(subtitleKind(sub(1, 'ger', { IsForced: true })), 'forced');
  assert.equal(subtitleKind(sub(1, 'ger', { Title: 'Deutsch (SDH)' })), 'sdh');
  assert.equal(subtitleKind(sub(1, 'eng', { Title: 'English CC' })), 'sdh');
  assert.equal(subtitleKind(sub(1, 'ger', { DisplayTitle: 'Deutsch - Hörgeschädigte - SUBRIP' })), 'sdh');
  assert.equal(subtitleKind(sub(1, 'ger', { IsForced: true, Title: 'SDH' })), 'forced', 'erzwungen geht vor');
  assert.equal(subtitleKind(sub(1, 'eng', { Title: 'Accent' })), 'full', 'Teilwoerter zaehlen nicht');
  assert.equal(subtitleKind(null), 'full');
});

test('Untertitel nach Sprache einteilen: bevorzugte zuerst, der Rest gesammelt, innerhalb einer Sprache normal vor erzwungen vor SDH', () => {
  const tracks = [sub(0, 'jpn'), sub(1, 'ger', { IsForced: true }), sub(2, 'eng'), sub(3, 'deu'), sub(4, 'ger', { Title: 'SDH' }), sub(5, 'fre'), sub(6, 'eng', { Title: 'CC' }), sub(7, undefined)];
  const g = groupByLanguage(tracks, { preferred: ['de', 'en'] });
  assert.deepEqual(g.shown.map((x) => x.code), ['de', 'en']);
  assert.deepEqual(g.shown[0].tracks.map((s) => s.Index), [3, 1, 4], 'Deutsch: normal (deu zaehlt mit), erzwungen, SDH');
  assert.deepEqual(g.shown[1].tracks.map((s) => s.Index), [2, 6]);
  assert.deepEqual(g.more.map((x) => x.code), ['ja', 'fr', 'und'], 'Rest in der Reihenfolge des ersten Auftretens');
  assert.equal(g.shown.length + g.more.length, 5);
  assert.equal([...g.shown, ...g.more].reduce((n, x) => n + x.tracks.length, 0), tracks.length, 'keine Spur geht verloren');
});

test('Untertitel nach Sprache: die Reihenfolge der bevorzugten Sprachen gilt, fehlende werden uebersprungen, die gewaehlte Spur bleibt sichtbar', () => {
  const tracks = [sub(0, 'jpn'), sub(1, 'eng'), sub(2, 'ger'), sub(3, 'fre')];
  const g = groupByLanguage(tracks, { preferred: ['es', 'en', 'de'], keep: [tracks[0]] });
  assert.deepEqual(g.shown.map((x) => x.code), ['en', 'de', 'ja'], 'Spanisch fehlt, English vor Deutsch, die gewaehlte (Japanisch) hinten dran');
  assert.deepEqual(g.more.map((x) => x.code), ['fr']);
  const none = groupByLanguage(tracks, {});
  assert.equal(none.shown.length, 0, 'ohne Wunsch ist alles unter "mehr"');
  assert.equal(none.more.length, 4);
  assert.deepEqual(groupByLanguage(null), { shown: [], more: [] });
  assert.deepEqual(groupByLanguage([], { preferred: ['de'] }), { shown: [], more: [] });
});

test('Untertitel nach Sprache: eigene Zugriffe (Spuren des Players mit lang und forced)', () => {
  const tracks = [{ id: 1, lang: 'eng', forced: false }, { id: 2, lang: 'ger', forced: true }, { id: 3, lang: 'ger', forced: false }];
  const g = groupByLanguage(tracks, { preferred: ['de'], lang: (t) => t.lang, kind: (t) => (t.forced ? 'forced' : 'full') });
  assert.deepEqual(g.shown[0].tracks.map((t) => t.id), [3, 2]);
  assert.deepEqual(g.more[0].tracks.map((t) => t.id), [1]);
});
