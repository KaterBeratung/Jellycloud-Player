'use strict';
// Wahl der Untertitelspur je Modus und die Regel, wann die Untertitelsprache wirkt (Plan P23, E-P3). Faelle aus TrackChoiceTests der Apple-App
// (Build 93, K1 und Nachtrag 2): die Einstellung "Untertitelsprache" ist genau in den Modi bedienbar, in denen sie die Wahl aendert; bei "Wie auf
// dem Server" und "Aus" sagt der Hinweis warum (Texte in src/renderer/js/i18n.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Media = require('../src/shared/media');

const audio = (Index, Language, IsDefault = false) => ({ Index, Type: 'Audio', Codec: 'aac', Channels: 2, Language, IsDefault });
const subtitle = (Index, Language, IsForced = false) => ({ Index, Type: 'Subtitle', Codec: 'subrip', Language, IsForced, IsTextSubtitleStream: true });
const source = (streams, server) => ({ Id: 's', Container: 'mkv', MediaStreams: streams, ...(server === undefined || server === null ? {} : { DefaultSubtitleStreamIndex: server }) });
// Englischer Ton (Standard), deutscher Ton; Untertitel Deutsch voll (3) und erzwungen (4), Englisch voll (5) und erzwungen (6); der Server schlaegt 5 vor
const film = () => source([audio(1, 'eng', true), audio(2, 'ger'), subtitle(3, 'ger'), subtitle(4, 'ger', true), subtitle(5, 'eng'), subtitle(6, 'eng', true)], 5);
// Dazu Franzoesisch voll (7) und Spanisch nur erzwungen (8)
const mixed = (server) => source([audio(1, 'eng', true), audio(2, 'ger'), subtitle(3, 'ger'), subtitle(4, 'ger', true), subtitle(5, 'eng'), subtitle(6, 'eng', true), subtitle(7, 'fre'), subtitle(8, 'spa', true)], server);
const pick = (src, mode, language, ui = 'de', audioLanguage) => Media.pickStreams(src, { audioLanguage, subtitleMode: mode, subtitleLanguage: language }, ui).subtitleIndex;

const MODES = ['server', 'off', 'forced', 'always', 'smart'];
const LANGUAGES = ['server', 'de', 'en', 'fr', 'es', 'ja']; // "server" heisst hier "Sprache der App"

test('Die Untertitelsprache aendert die Wahl genau in den Modi, in denen die Einstellung sie bedienbar zeigt', () => {
  for (const mode of MODES) {
    const results = new Set();
    for (const language of LANGUAGES) for (const ui of ['de', 'en']) results.add(pick(film(), mode, language, ui));
    assert.equal(results.size > 1, Media.subtitleModeNeedsLanguage(mode), `Modus ${mode}: ${[...results].sort()}`);
  }
  assert.equal(Media.subtitleModeNeedsLanguage(undefined), false, 'ohne Angabe: wie auf dem Server');
  assert.equal(Media.subtitleModeNeedsLanguage('unbekannt'), false);
});

test('Alle Modi x Untertitelsprache x Sprache der Oberflaeche: die gewaehlte Spur', () => {
  const expected = (mode, lang) => {
    if (mode === 'off') return -1;
    if (mode === 'forced') return lang === 'de' ? 4 : lang === 'en' ? 6 : -1;
    if (mode === 'always') return lang === 'de' ? 3 : lang === 'en' ? 5 : -1;
    if (mode === 'smart') return lang === 'en' ? 6 : lang === 'de' ? 3 : -1; // der Ton ist Englisch: bei Englisch nur erzwungene
    return 5; // wie auf dem Server
  };
  for (const mode of MODES) {
    for (const language of LANGUAGES) {
      for (const ui of ['de', 'en']) {
        const lang = language === 'server' ? ui : language;
        assert.equal(pick(film(), mode, language, ui), expected(mode, lang), `Modus ${mode}, Untertitelsprache ${language}, Oberflaeche ${ui}`);
      }
    }
  }
  assert.equal(pick(film(), 'unbekannt', 'de', 'de'), 5, 'unbekannter Modus: die Spur des Servers');
  assert.equal(pick(source([audio(1, 'eng'), subtitle(2, 'ger')]), 'server', 'de', 'de'), -1, 'ohne Vorschlag des Servers keine');
});

test('Wie auf dem Server: die Spur, die Jellyfin fuer das Konto vorschlaegt, gleich welche Sprache die App eingestellt hat', () => {
  for (const language of LANGUAGES) for (const ui of ['de', 'en']) assert.equal(pick(mixed(7), 'server', language, ui), 7, `${language}/${ui}`);
  assert.equal(pick(mixed(4), 'server', 'en'), 4, 'auch eine erzwungene, wenn Jellyfin sie nennt');
  assert.equal(pick(mixed(null), 'server', 'de'), -1);
});

test('Aus: keine Untertitel, auch wenn Jellyfin eine Spur vorschlaegt', () => {
  for (const language of LANGUAGES) assert.equal(pick(mixed(5), 'off', language), -1, language);
});

test('Nur erzwungene, Immer und Smart waehlen nach der Untertitelsprache der App, nie nach dem Vorschlag des Servers', () => {
  const m = mixed(5);
  assert.deepEqual(['de', 'en', 'es', 'fr'].map((l) => pick(m, 'forced', l)), [4, 6, 8, -1]);
  assert.equal(pick(m, 'forced', 'server', 'de'), 4, '"Sprache der App"');
  assert.deepEqual(['de', 'fr', 'es', 'ja'].map((l) => pick(m, 'always', l)), [3, 7, 8, -1]);
  assert.equal(pick(m, 'always', 'server', 'en'), 5);
  assert.equal(pick(m, 'smart', 'en'), 6, 'Ton Englisch, Sprache Englisch: erzwungene');
  assert.equal(pick(m, 'smart', 'de'), 3, 'Ton Englisch, Sprache Deutsch: volle');
  assert.equal(pick(m, 'smart', 'de', 'de', 'de'), 4, 'Ton Deutsch gewaehlt: erzwungene');
  assert.equal(pick(m, 'smart', 'en', 'de', 'de'), 5);
});

test('Hinweise der Einstellungen: einer je Modus in beiden Sprachen, der Grund fuer die ausgeschaltete Sprache genau dort, wo sie nicht wirkt', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'i18n.js'), 'utf8');
  const [de, en] = text.split(/^const en = \{/m);
  const has = (block, key) => new RegExp(`^\\s*'${key.replace(/\./g, '\\.')}':\\s*'[^']+`, 'm').test(block);
  for (const mode of MODES) {
    for (const [name, block] of [['de', de], ['en', en]]) {
      assert.ok(has(block, `set.subHint.${mode}`), `Hinweis ${mode} (${name})`);
      assert.equal(has(block, `set.subLangUnused.${mode}`), !Media.subtitleModeNeedsLanguage(mode), `Grund ${mode} (${name})`);
    }
  }
  assert.match(de, /'set\.subLangUnused\.server':\s*'[^']*Jellyfin[^']*Konto[^']*Einstellungen › Untertitel/, 'sagt, wo man die Sprache dann einstellt');
});
