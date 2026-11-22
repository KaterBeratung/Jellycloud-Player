'use strict';

// Adresse eines Servers aus der Eingabe (Plan L7): die Faelle der Apple-App (JellycloudTests/ServerAddressTests.swift, 7 Tests) gegen die Regeln
// von Windows und Android (src/shared/jellyfin.js, src/shared/seerr.js). Beide Apps sollen aus derselben Eingabe dieselbe Adresse machen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServerUrl, candidateUrls, JellyfinError } = require('../src/shared/jellyfin');
const { normalizeSeerrUrl, candidateSeerrUrls, SeerrError } = require('../src/shared/seerr');

test('Jellyfin: Schema ergaenzt, Host klein, Reste der Web-Oberflaeche und Schraegstriche weg', () => {
  assert.equal(normalizeServerUrl('  Jelly.Example.COM/web/index.html '), 'http://jelly.example.com');
  assert.equal(normalizeServerUrl('HTTPS://Jelly.Example.com/jellyfin/web/'), 'https://jelly.example.com/jellyfin');
  assert.equal(normalizeServerUrl('http://10.0.0.5:8096///'), 'http://10.0.0.5:8096');
});

test('Standardport, Anfrage, Fragment und Zugangsdaten entfallen', () => {
  assert.equal(normalizeServerUrl('http://host.test:80/'), 'http://host.test');
  assert.equal(normalizeServerUrl('https://host.test:443'), 'https://host.test');
  assert.equal(normalizeServerUrl('https://host.test:8920'), 'https://host.test:8920');
  assert.equal(normalizeServerUrl('https://name:geheim@host.test/web?x=1#y'), 'https://host.test');
  assert.equal(normalizeSeerrUrl('https://name:geheim@seerr.test:443/api/v1/?x=1#y'), 'https://seerr.test');
});

test('Seerr: Reste der Schnittstelle weg, sonst dieselbe Regel', () => {
  assert.equal(normalizeSeerrUrl('Seerr.Example.com/api/v1'), 'http://seerr.example.com');
  assert.equal(normalizeSeerrUrl('https://example.com/seerr/api/'), 'https://example.com/seerr');
  assert.equal(normalizeSeerrUrl('http://10.0.0.5:5055/'), 'http://10.0.0.5:5055');
  // Der Pfad der Web-Oberflaeche von Jellyfin gehoert bei Seerr nicht zur Regel
  assert.equal(normalizeSeerrUrl('https://example.com/web'), 'https://example.com/web');
});

test('Leere und unbrauchbare Eingaben melden den Fehler des jeweiligen Dienstes', () => {
  assert.throws(() => normalizeServerUrl('   '), JellyfinError);
  assert.throws(() => normalizeServerUrl('http://'), JellyfinError);
  assert.throws(() => candidateUrls(''), JellyfinError);
  assert.throws(() => normalizeSeerrUrl(''), SeerrError);
  assert.throws(() => normalizeSeerrUrl('https://'), SeerrError);
  assert.throws(() => candidateSeerrUrls(' '), SeerrError);
});

test('Fehlertexte wie in der Apple-App', () => {
  const text = (fn) => {
    try {
      fn();
      return '';
    } catch (e) {
      return e.message;
    }
  };
  assert.equal(text(() => normalizeServerUrl('')), 'Server-Adresse fehlt');
  assert.equal(text(() => normalizeServerUrl('http://')), 'Ungültige Server-Adresse');
  assert.equal(text(() => normalizeSeerrUrl('')), 'Seerr-Adresse fehlt');
  assert.equal(text(() => normalizeSeerrUrl('http://')), 'Ungültige Seerr-Adresse');
});

test('Ohne Schema: https, dann http, dann http mit dem Standardport des Dienstes', () => {
  assert.deepEqual(candidateUrls('jelly.test'), ['https://jelly.test', 'http://jelly.test', 'http://jelly.test:8096']);
  assert.deepEqual(candidateSeerrUrls('seerr.test'), ['https://seerr.test', 'http://seerr.test', 'http://seerr.test:5055']);
  // Mit Pfad: der Standardport gilt fuer den Host allein
  assert.deepEqual(candidateUrls('jelly.test/jf'), ['https://jelly.test/jf', 'http://jelly.test/jf', 'http://jelly.test:8096']);
});

test('Mit Schema oder eigenem Port wird nichts dazugeraten', () => {
  assert.deepEqual(candidateUrls('http://jelly.test'), ['http://jelly.test']);
  assert.deepEqual(candidateUrls('jelly.test:9000'), ['https://jelly.test:9000', 'http://jelly.test:9000']);
  assert.deepEqual(candidateSeerrUrls('HTTPS://seerr.test/api/v1'), ['https://seerr.test']);
  assert.deepEqual(candidateSeerrUrls('seerr.test:7000'), ['https://seerr.test:7000', 'http://seerr.test:7000']);
});
