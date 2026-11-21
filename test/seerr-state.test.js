'use strict';
/**
 * Staende bei Seerr (src/shared/seerr-state.js), Werte nach Seerr 3.5.1: 6 gesperrt, 7 geloescht. Faelle aus
 * JellycloudTests/SeerrMediaStateTests.swift der Apple-App (Teil "anfragbar, vorhanden, vergeben").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/seerr-state');
const Tags = require('../src/shared/media-tags');
const { SEERR_MEDIA, isRequestable, isPresent, isTaken, isBlocklisted } = S;

test('Werte wie bei Seerr 3.5.1: 6 gesperrt, 7 geloescht', () => {
  assert.equal(SEERR_MEDIA.BLOCKLISTED, 6);
  assert.equal(SEERR_MEDIA.DELETED, 7);
  assert.ok(Object.isFrozen(SEERR_MEDIA));
});

test('Anfragbar nur ohne Stand und nach dem Loeschen; nie gesperrt, nie ein unbekannter Wert', () => {
  for (const s of [0, 1, 7, null, undefined, '7']) assert.equal(isRequestable(s), true, `anfragbar: ${s}`);
  for (const s of [2, 3, 4, 5, 6, 8, 99, -1, 'x']) assert.equal(isRequestable(s), false, `nicht anfragbar: ${s}`);
});

test('Gegenprobe zum Fehler bis 1.1.6: gesperrt (6) nicht anfragbar, geloescht (7) anfragbar', () => {
  const old = (s) => s <= 1 || s === 6; // die alte Regel der Ansichten
  assert.notEqual(old(6), isRequestable(6));
  assert.notEqual(old(7), isRequestable(7));
});

test('Vorhanden (4, 5), vergeben (2 bis 5), gesperrt (6)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isPresent), [4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isTaken), [2, 3, 4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isBlocklisted), [6]);
});

// ---------- Ein Stand, eine Darstellung (P4; JellycloudTests/SeerrMediaStateTests.swift) ----------
const { PENDING, APPROVED, DECLINED, FAILED, COMPLETED } = S.SEERR_REQUEST;
const film = (status, media) => ({ status, mediaStatus: media, mediaType: 'movie', seasons: [] });
const REQUESTS = [null, PENDING, APPROVED, DECLINED, FAILED, COMPLETED];
const MEDIA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

test('Meldung zu Build 90 der Apple-App: "In Bearbeitung" sieht im Reiter Anfragen und auf der Seite des Titels gleich aus', () => {
  const card = Tags.seerrRequest(film(APPROVED, 3));
  const page = Tags.seerrAvailability(3);
  assert.equal(card.text, 'In Bearbeitung');
  assert.equal(page.text, 'In Bearbeitung');
  assert.equal(card.kind, page.kind);
});

test('Eine Anfrage, die auf ihre Genehmigung wartet, heisst ueberall gleich', () => {
  const card = Tags.seerrRequest(film(PENDING, 2));
  const page = Tags.seerrAvailability(2);
  assert.equal(card.text, page.text);
  assert.equal(card.kind, page.kind);
});

test('Jede Bezeichnung hat genau eine Art und jede Art genau eine Bezeichnung, ueber alle Staende von Anfrage und Titel', () => {
  const tags = MEDIA.map((m) => Tags.seerrAvailability(m)).filter(Boolean);
  for (const r of REQUESTS) for (const m of MEDIA) tags.push(Tags.seerrRequest(film(r, m)));
  const kindsOf = new Map();
  const textsOf = new Map();
  for (const tag of tags.filter((x) => x.kind !== 'neutral')) {
    kindsOf.set(tag.text, new Set([...(kindsOf.get(tag.text) ?? []), tag.kind]));
    textsOf.set(tag.kind, new Set([...(textsOf.get(tag.kind) ?? []), tag.text]));
  }
  for (const [text, kinds] of kindsOf) assert.equal(kinds.size, 1, `"${text}" in ${[...kinds]}`);
  for (const [kind, texts] of textsOf) assert.equal(texts.size, 1, `${kind} traegt ${[...texts]}`);
});

test('Stand einer Anfrage: jede Kombination aus Anfrage und Titel', () => {
  const cases = [
    [PENDING, 2, 'requested'], [PENDING, 1, 'requested'], [PENDING, 4, 'requested'], [PENDING, 5, 'available'],
    [APPROVED, 1, 'approved'], [APPROVED, 2, 'approved'], [APPROVED, 3, 'processing'], [APPROVED, 4, 'partiallyAvailable'], [APPROVED, 5, 'available'],
    [DECLINED, 1, 'declined'], [DECLINED, 3, 'declined'], [DECLINED, 4, 'declined'], [DECLINED, 5, 'available'],
    [FAILED, 3, 'failed'], [FAILED, 1, 'failed'], [FAILED, 4, 'failed'], [FAILED, 5, 'available'],
    [COMPLETED, 5, 'available'], [COMPLETED, 4, 'partiallyAvailable']
  ];
  for (const [status, media, want] of cases) assert.equal(S.requestState(status, media), want, `Anfrage ${status}, Titel ${media}`);
});

test('Stand eines Titels: was da ist, geht vor; eine gescheiterte Anfrage vor "in Bearbeitung"; eine abgelehnte nur ohne laufende', () => {
  const cases = [
    [5, null, 'available'], [5, DECLINED, 'available'], [4, FAILED, 'partiallyAvailable'], [4, null, 'partiallyAvailable'],
    [3, null, 'processing'], [3, APPROVED, 'processing'], [3, FAILED, 'failed'], [3, DECLINED, 'processing'],
    [2, null, 'requested'], [2, PENDING, 'requested'], [2, APPROVED, 'approved'], [2, DECLINED, 'requested'], [2, FAILED, 'failed'],
    [1, null, null], [0, null, null], [1, DECLINED, 'declined'], [0, DECLINED, 'declined'], [1, APPROVED, 'approved'], [1, PENDING, 'requested'],
    [1, COMPLETED, null], [7, COMPLETED, null], [7, null, null], [6, null, null], [9, null, null]
  ];
  for (const [media, request, want] of cases) assert.equal(S.titleState(media, request), want, `Titel ${media}, Anfrage ${request}`);
});

test('Ein Film mit einer Anfrage: das Plakat der Anfrage und die Seite des Films zeigen denselben Stand', () => {
  for (const [status, media] of [[PENDING, 2], [APPROVED, 2], [APPROVED, 3], [DECLINED, 1], [FAILED, 3], [FAILED, 2], [COMPLETED, 5], [APPROVED, 5]]) {
    assert.deepEqual(Tags.seerrRequest(film(status, media)), Tags.seerrAvailability(media, status), `Anfrage ${status}, Titel ${media}`);
  }
});

test('Unbekannte Werte von Seerr ergeben nie einen Stand, der nur so aussieht', () => {
  assert.deepEqual([Tags.seerrRequest(film(null, 3)).kind, Tags.seerrRequest(film(null, 3)).text], ['neutral', 'Unbekannt']);
  assert.equal(Tags.seerrRequest(film(null, 9)).text, 'Unbekannt');
  assert.equal(Tags.seerrRequest(film(9, 3)).text, 'Unbekannt', 'ein Anfragestand, den es nicht gibt');
  assert.equal(Tags.seerrAvailability(9), null);
  assert.equal(Tags.seerrAvailability(6), null, 'gesperrt: kein Stand, und nicht anfragbar');
  assert.deepEqual([Tags.seerrRequest(film(COMPLETED, 7)).kind, Tags.seerrRequest(film(COMPLETED, 7)).text], ['neutral', 'Abgeschlossen'], 'erledigt, Titel nicht mehr da: nicht "Verfuegbar"');
  assert.equal(S.titleState('x', 'y'), null);
});

test('Jeder Stand hat eine eigene Bezeichnung (DE und EN) und eine eigene Art; alle gehoeren zur Gruppe Stand', () => {
  for (const lang of ['de', 'en']) assert.equal(new Set(S.STATES.map((s) => S.label(s, lang))).size, S.STATES.length, lang);
  assert.equal(new Set(S.STATES.map((s) => S.TAG_KIND[s])).size, S.STATES.length);
  for (const s of S.STATES) assert.equal(Tags.seerr(s).group, 'status', s);
  assert.equal(S.label('available', 'en-GB'), 'Available');
  assert.equal(Tags.seerr('partiallyAvailable').short, 'Teilweise', 'schmale Plakate: nie abgeschnitten');
  assert.equal(Tags.seerr('partiallyAvailable', 'en').text, 'Partially available');
});

test('Anfrage fuer Staffeln: Stand aus den angefragten Staffeln, nicht aus dem Stand der ganzen Serie', () => {
  const tv = (status, media, seasons, ready) => ({ status, mediaStatus: media, mediaType: 'tv', seasons, readySeasons: ready });
  assert.equal(S.requestOf(tv(COMPLETED, 4, [3], 1)), 'available', 'abgeschlossen: die angefragte Staffel ist da (die Serie nur teilweise)');
  assert.equal(S.requestOf(tv(COMPLETED, 5, [1, 2], 2)), 'available');
  assert.equal(S.requestOf(tv(APPROVED, 4, [3, 4], 1)), 'partiallyAvailable', 'ein Teil ist da');
  assert.equal(S.requestOf(tv(COMPLETED, 7, [3], 1)), null, 'die Serie wurde spaeter geloescht');
  assert.equal(S.requestOf(tv(PENDING, 4, [3], 0)), 'requested');
  assert.equal(S.requestOf(tv(DECLINED, 4, [3], 0)), 'declined');
  assert.equal(S.requestOf(tv(FAILED, 4, [3], 0)), 'failed');
  assert.equal(S.requestOf(film(APPROVED, 3)), 'processing', 'Film: unveraendert');
  assert.equal(S.requestOf(null), null);
});

test('Offene Anfragen: wartend, gescheitert oder genehmigt und noch nicht da', () => {
  assert.equal(S.isOpen(film(PENDING, 2)), true);
  assert.equal(S.isOpen(film(FAILED, 3)), true);
  assert.equal(S.isOpen(film(APPROVED, 3)), true);
  assert.equal(S.isOpen(film(APPROVED, 5)), false, 'genehmigt und da');
  assert.equal(S.isOpen(film(DECLINED, 1)), false);
  assert.equal(S.isOpen(film(COMPLETED, 5)), false);
  assert.equal(S.isOpen(null), false);
});

test('Platzhalter-Stand eines Titels, solange seine Seite laedt: nie "anfragbar" fuer einen angefragten Titel', () => {
  const want = { available: 5, partiallyAvailable: 4, approved: 3, processing: 3, failed: 3, requested: 2, declined: 1 };
  for (const s of S.STATES) assert.equal(S.placeholderMediaStatus(s), want[s], s);
  for (const s of S.STATES.filter((x) => x !== 'declined')) assert.equal(S.isRequestable(S.placeholderMediaStatus(s)), false, s);
});

test('Rechte (Seerr 3.5.1): Administrator darf alles; verwalten, alle ansehen, anfragen fuer Film oder Serie', () => {
  const P = S.PERMISSIONS;
  assert.deepEqual([P.ADMIN, P.MANAGE_REQUESTS, P.REQUEST, P.REQUEST_VIEW, P.REQUEST_MOVIE, P.REQUEST_TV], [2, 16, 32, 16384, 262144, 524288]);
  assert.equal(S.canManageRequests(P.ADMIN), true);
  assert.equal(S.canViewAllRequests(P.ADMIN), true);
  assert.equal(S.canRequest(P.ADMIN, true), true);
  assert.equal(S.canManageRequests(P.REQUEST), false);
  assert.equal(S.canViewAllRequests(P.REQUEST_VIEW), true);
  assert.equal(S.canViewAllRequests(P.MANAGE_REQUESTS), true);
  assert.equal(S.canViewAllRequests(P.REQUEST), false);
  assert.equal(S.canRequest(P.REQUEST, false), true);
  assert.equal(S.canRequest(P.REQUEST_MOVIE, true), true);
  assert.equal(S.canRequest(P.REQUEST_MOVIE, false), false, 'nur Filme');
  assert.equal(S.canRequest(P.REQUEST_TV, false), true);
  assert.equal(S.canRequest(1072, true), true, 'Standardrechte des Testservers (1024 + 32 + 16)');
  assert.equal(S.canRequest(0, true), false);
  assert.equal(S.canRequest('kaputt', true), false);
  assert.equal(S.canManageRequests(-1), false, 'Unsinn gibt keine Rechte');
});