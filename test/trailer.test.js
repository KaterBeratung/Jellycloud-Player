'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeId, trailerVideoId } = require('../src/shared/media');
const { DEFAULT_SETTINGS, deepMerge } = require('../src/main/config');

test('YouTube-Links: alle gaengigen Formen ergeben die Video-ID', () => {
  const id = 'aqz-KE-bpKQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=30s`,
    `https://www.youtube.com/watch?feature=share&v=${id}`,
    `http://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    `https://www.youtube.com/shorts/${id}`,
    `  https://www.youtube.com/watch?v=${id}  `
  ]) {
    assert.equal(youtubeId(url), id, url);
  }
});

test('Keine YouTube-Links ergeben null (auch bei Angriffsversuchen im Link)', () => {
  for (const url of ['https://example.com/trailer', 'https://vimeo.com/123456789', 'https://www.youtube.com/watch?v=zu-kurz', 'https://www.youtube.com/watch?v=aqz-KE-bpKQxx', 'https://evil.com/?u=https://youtu.be/aqz-KE-bpKQ', 'javascript:alert(1)', '', null, undefined, 42]) {
    assert.equal(youtubeId(url), null, String(url));
  }
});

test('Trailer eines Eintrags: erster YouTube-Link, andere Links werden uebersprungen', () => {
  assert.equal(trailerVideoId({ RemoteTrailers: [{ Url: 'https://example.com/t' }, { Url: 'https://youtu.be/aqz-KE-bpKQ' }] }), 'aqz-KE-bpKQ');
  assert.equal(trailerVideoId({ RemoteTrailers: [{ Url: 'https://example.com/t' }] }), null);
  assert.equal(trailerVideoId({ RemoteTrailers: [] }), null);
  assert.equal(trailerVideoId({}), null);
  assert.equal(trailerVideoId(null), null);
});

test('Trailer-Einstellungen: Standard (an, stumm, sofort, bis 4K, Lautstaerke 10 %, Ausblenden nach 10 s), alte Konfigurationen bekommen sie ergaenzt, Werte werden uebernommen', () => {
  assert.deepEqual(DEFAULT_SETTINGS.trailer, { autoplay: true, home: true, muted: true, delaySec: 0, quality: '2160', volume: 10, focusStyle: 'corner', focusSec: 10 });
  const old = deepMerge(DEFAULT_SETTINGS, { appearance: { radius: 20 } });
  assert.equal(old.trailer.muted, true, 'fehlender Abschnitt kommt aus den Standardwerten');
  assert.equal(deepMerge(DEFAULT_SETTINGS, { trailer: { muted: false } }).trailer.quality, '2160', 'Konfiguration ohne Qualitaet: bis 4K');
  const own = deepMerge(DEFAULT_SETTINGS, { trailer: { muted: false, delaySec: 5, quality: '1080', volume: 40, focusSec: 0 } });
  assert.deepEqual(own.trailer, { autoplay: true, home: true, muted: false, delaySec: 5, quality: '1080', volume: 40, focusStyle: 'corner', focusSec: 0 });
  assert.equal(deepMerge(DEFAULT_SETTINGS, { trailer: { focusStyle: 'poster' } }).trailer.focusStyle, 'poster', 'der alte Stil bleibt waehlbar');
  assert.equal(deepMerge(DEFAULT_SETTINGS, { trailer: { focusStyle: 5 } }).trailer.focusStyle, 'corner', 'falscher Typ wird verworfen');
  assert.equal(deepMerge(DEFAULT_SETTINGS, { trailer: { delaySec: 'x' } }).trailer.delaySec, 0, 'falscher Typ wird verworfen');
});
