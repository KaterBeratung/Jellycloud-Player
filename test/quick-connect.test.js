'use strict';

// Quick Connect fuer andere Geraete (Plan K3, L17): die 13 Faelle der Apple-App (JellycloudTests/QuickConnectAuthorizeTests.swift) gegen
// src/shared/quick-connect.js: Bereinigung des Codes, Zuordnung der Antworten von Jellyfin und der Zustand der Maske (eine Bestaetigung zur Zeit,
// nichts nach dem Schliessen, der Code bleibt nirgends stehen).
const test = require('node:test');
const assert = require('node:assert/strict');
const QC = require('../src/shared/quick-connect');

/** Fehler wie JellyfinError: Antwort des Servers (status, Text) oder Netzfehler (code OFFLINE/TIMEOUT). */
const http = (status, body = null) => Object.assign(new Error(`HTTP ${status}`), { status, body });
const offline = () => Object.assign(new Error('Netzwerkfehler: keine Verbindung'), { status: 0, code: 'OFFLINE' });
const timeout = () => Object.assign(new Error('Zeitueberschreitung bei der Anfrage'), { status: 0, code: 'TIMEOUT' });

/** Der Server der Tests: zaehlt die Bestaetigungen und haelt sie auf Wunsch an, bis der Test sie freigibt. */
function server() {
  const s = { codes: [], enabled: () => true, answer: () => true, held: null };
  s.hold = () => {
    let release;
    s.held = new Promise((r) => (release = r));
    s.release = () => {
      release();
      s.held = null;
    };
  };
  s.isEnabled = async () => s.enabled();
  s.authorize = async (code) => {
    s.codes.push(code);
    if (s.held) await s.held;
    return s.answer();
  };
  return s;
}
const authorizer = (s) => QC.createAuthorizer({ isEnabled: s.isEnabled, authorize: s.authorize });
/** Wartet, bis die Maske diesen Zustand zeigt (die Bestaetigung laeuft nebenher). */
async function reach(phase, model) {
  for (let i = 0; i < 200 && model.phase !== phase; i++) await new Promise((r) => setImmediate(r));
  return model.phase === phase;
}

test('Der Code besteht aus hoechstens sechs Ziffern; Leerzeichen, Bindestriche und alles andere fallen weg', () => {
  assert.equal(QC.clean('428 193'), '428193');
  assert.equal(QC.clean('42-81-93'), '428193');
  assert.equal(QC.clean('4281937'), '428193');
  assert.equal(QC.clean('ab12'), '12');
  assert.equal(QC.clean('４２８'), '', 'nur die Ziffern 0 bis 9, keine anderer Schriften');
  assert.ok(QC.isComplete('428193'));
  assert.ok(!QC.isComplete('42819'));
  assert.ok(!QC.isComplete('42819a'));
});

test('Die Antworten von Jellyfin werden zu den passenden Meldungen', () => {
  const kind = (e, enabled = true) => QC.classify(e, enabled);
  assert.deepEqual(kind(http(404, 'Unable to find request')), { kind: 'unknownCode' });
  assert.deepEqual(kind(http(500, 'Request is already authorized')), { kind: 'alreadyAuthorized' });
  // ein Fehler des Servers ohne erkennbaren Grund wird nicht als etwas Bestimmtes ausgegeben
  assert.deepEqual(kind(http(500, 'Error processing request.')), { kind: 'rejected', status: 500 });
  // 401 kommt bei ausgeschaltetem Quick Connect und bei einem ungueltigen Token
  assert.deepEqual(kind(http(401, 'Quick connect is disabled')), { kind: 'disabled' });
  assert.deepEqual(kind(http(401), false), { kind: 'disabled' });
  assert.deepEqual(kind(http(401)), { kind: 'signedOut' });
  assert.deepEqual(kind(offline()), { kind: 'unreachable' });
  // keine Antwort in der Frist: die Anfrage kann angekommen sein, also nicht "nicht erreichbar"
  assert.deepEqual(kind(timeout()), { kind: 'timedOut' });
  // ein Proxy vor dem Server (502 bis 504) ist kein Fehler des Codes; andere Antworten werden nicht als "Code ungueltig" ausgegeben
  assert.deepEqual(kind(http(503)), { kind: 'unreachable' });
  assert.ok(!QC.concernsCode(kind(http(400))));
  assert.ok(!QC.concernsCode(kind(http(403))));
  // Meldungen zum Code markieren das Feld; die anderen nicht
  assert.ok(['unknownCode', 'alreadyAuthorized', 'rejected'].every((k) => QC.concernsCode({ kind: k })));
  assert.ok(['unreachable', 'signedOut', 'disabled'].every((k) => !QC.concernsCode({ kind: k })));
  // Ueber die IPC-Grenze kommt der Text nicht mit: die Rueckseite gibt den Hinweis als code weiter, die Oberflaeche liest ihn wieder
  assert.equal(QC.hintOf(http(500, 'Request is already authorized')), QC.HINT.already);
  assert.equal(QC.hintOf(http(401, 'Quick connect is disabled')), QC.HINT.disabled);
  assert.deepEqual(kind({ status: 500, code: QC.HINT.already }), { kind: 'alreadyAuthorized' });
  assert.deepEqual(kind({ status: 401, code: QC.HINT.disabled }), { kind: 'disabled' });
});

test('Bestaetigen: der Code geht einmal an den Server, die Maske zeigt den Erfolg, der Code ist danach weg', async () => {
  const s = server();
  const model = authorizer(s);
  await model.prepare();
  assert.equal(model.phase, 'ready');
  model.enter('428 193');
  assert.equal(model.code, '428193');
  assert.ok(model.canSubmit);
  await model.submit();
  assert.equal(model.phase, 'done');
  assert.equal(model.code, '');
  assert.deepEqual(s.codes, ['428193']);
});

test('Ein unvollstaendiger Code wird nicht geschickt', async () => {
  const s = server();
  const model = authorizer(s);
  await model.prepare();
  model.enter('4281');
  assert.ok(!model.canSubmit);
  await model.submit();
  assert.equal(model.phase, 'ready');
  assert.deepEqual(s.codes, []);
});

test('Unbekannter oder abgelaufener Code: Meldung, der Code bleibt zum Korrigieren stehen, die Meldung geht mit der naechsten Eingabe', async () => {
  const s = server();
  s.answer = () => {
    throw http(404, 'Unable to find request');
  };
  const model = authorizer(s);
  await model.prepare();
  model.enter('111111');
  await model.submit();
  assert.equal(model.phase, 'ready');
  assert.deepEqual(model.error, { kind: 'unknownCode' });
  assert.equal(model.code, '111111');
  model.enter('11111');
  assert.equal(model.error, null);
});

test('Schon bestaetigter Code: eigene Meldung', async () => {
  const s = server();
  s.answer = () => {
    throw http(500, 'Request is already authorized');
  };
  const model = authorizer(s);
  await model.prepare();
  model.enter('428193');
  await model.submit();
  assert.deepEqual(model.error, { kind: 'alreadyAuthorized' });
  assert.equal(model.phase, 'ready');
});

test('Quick Connect ausgeschaltet: die Maske sagt es beim Oeffnen und schickt nichts', async () => {
  const s = server();
  s.enabled = () => false;
  const model = authorizer(s);
  await model.prepare();
  assert.equal(model.phase, 'disabled');
  model.enter('428193');
  assert.equal(model.code, '', 'keine Eingabe ohne Feld');
  await model.submit();
  assert.deepEqual(s.codes, []);
});

test('401 beim Bestaetigen: ausgeschaltet, wenn der Server es so sagt, sonst ist die Anmeldung des Profils abgelaufen', async () => {
  const expired = server();
  expired.answer = () => {
    throw http(401);
  };
  const first = authorizer(expired);
  await first.prepare();
  first.enter('428193');
  await first.submit();
  assert.deepEqual(first.error, { kind: 'signedOut' });
  assert.equal(first.phase, 'ready');

  const off = server();
  off.answer = () => {
    throw http(401, 'Quick connect is disabled');
  };
  const second = authorizer(off);
  await second.prepare();
  second.enter('428193');
  await second.submit();
  assert.equal(second.phase, 'disabled');
  assert.equal(second.code, '');
});

test('401 ohne Text bei ausgeschaltetem Quick Connect: die Maske fragt nach und sagt "ausgeschaltet", nicht "Anmeldung abgelaufen"', async () => {
  const s = server();
  const model = authorizer(s);
  await model.prepare();
  model.enter('428193');
  // zwischen dem Oeffnen und dem Bestaetigen wird Quick Connect am Server ausgeschaltet
  s.enabled = () => false;
  s.answer = () => {
    throw http(401);
  };
  await model.submit();
  assert.equal(model.phase, 'disabled');
  assert.equal(model.error, null);
});

test('Abbrechen laesst stehen, was die Maske zeigt, bis sie zu ist; das spaete Ergebnis aendert trotzdem nichts', async () => {
  const s = server();
  const model = authorizer(s);
  await model.prepare();
  model.enter('428193');
  await model.submit();
  assert.equal(model.phase, 'done');
  model.cancel();
  assert.equal(model.phase, 'done', 'kein Sprung auf "Verbindung wird geprueft", waehrend die Maske aus dem Bild geht');
  model.close();
  assert.equal(model.phase, 'checking');

  const slow = server();
  slow.hold();
  const second = authorizer(slow);
  await second.prepare();
  second.enter('428193');
  const running = second.submit();
  assert.ok(await reach('working', second));
  second.cancel();
  slow.release();
  await running;
  assert.equal(second.phase, 'working', 'das Ergebnis kam nach dem Abbrechen: nicht "bestaetigt"');
});

test('Server beim Oeffnen nicht erreichbar: die Eingabe bleibt offen, die Bestaetigung meldet den Fehler und behaelt den Code', async () => {
  const s = server();
  s.enabled = () => {
    throw offline();
  };
  s.answer = () => {
    throw offline();
  };
  const model = authorizer(s);
  await model.prepare();
  assert.equal(model.phase, 'ready');
  model.enter('428193');
  await model.submit();
  assert.deepEqual(model.error, { kind: 'unreachable' });
  assert.equal(model.code, '428193');
  assert.ok(model.canSubmit, 'noch einmal versuchen, ohne neu zu tippen');
});

test('Waehrend einer Bestaetigung loest ein zweites Tippen keine zweite aus', async () => {
  const s = server();
  s.hold();
  const model = authorizer(s);
  await model.prepare();
  model.enter('428193');
  const running = model.submit();
  assert.ok(await reach('working', model));
  assert.ok(!model.canSubmit);
  await model.submit(); // das zweite Tippen
  await model.submit();
  // Eingaben nimmt die Maske waehrenddessen nicht an
  model.enter('000000');
  assert.equal(model.code, '428193');
  s.release();
  await running;
  assert.equal(model.phase, 'done');
  assert.deepEqual(s.codes, ['428193']);
});

test('Schliesst die Maske waehrend der Bestaetigung, aendert das spaete Ergebnis nichts mehr und der Code ist weg', async () => {
  const s = server();
  s.hold();
  const model = authorizer(s);
  await model.prepare();
  model.enter('428193');
  const running = model.submit();
  assert.ok(await reach('working', model));
  model.close();
  assert.equal(model.code, '');
  s.release();
  await running;
  assert.equal(model.phase, 'checking', 'nicht "bestaetigt"');
  assert.equal(model.error, null);
  assert.equal(model.code, '');
});
