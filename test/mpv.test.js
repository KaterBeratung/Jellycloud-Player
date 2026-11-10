'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { MpvPlayer } = require('../src/main/mpv');

const FAKE = path.join(__dirname, 'fake-mpv.js');
const make = (env = {}) => {
  const pipe = `\\\\.\\pipe\\jc-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  return new MpvPlayer({ exe: process.execPath, spawnPrefix: [FAKE], args: [`--input-ipc-server=${pipe}`], pipe, env: { ...process.env, ...env } });
};
const once = (em, ev, ms = 5000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Zeitueberschreitung: ${ev}`)), ms);
    em.once(ev, (v) => {
      clearTimeout(t);
      res(v);
    });
  });
const waitProp = (m, name, pred, ms = 5000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Zeitueberschreitung: ${name}`)), ms);
    const check = (n, v) => {
      if (n === name && pred(v)) {
        clearTimeout(t);
        m.off('property', check);
        res(v);
      }
    };
    m.on('property', check);
    if (pred(m.prop(name))) check(name, m.prop(name));
  });

test('mpv-Controller: Start, Laden, Seek, Pause, Spuren, Beenden', async (t) => {
  const log = path.join(os.tmpdir(), `jc-fake-${process.pid}.log`);
  const m = make({ FAKE_DURATION: '120', FAKE_LOG: log });
  await m.start();
  t.after(() => m.quit());

  await m.load({ url: 'http://x/video', headers: ['Authorization: MediaBrowser Token="t"'], start: 30, aid: 2, sid: 1, externalSubs: [{ index: 9, url: 'http://x/s.srt', title: 'Ext', lang: 'ger' }] });
  await once(m, 'file-loaded');
  assert.equal(m.prop('duration'), 120);
  assert.ok(Math.abs(m.prop('time-pos') - 30) < 1, 'Startposition wird uebernommen');
  assert.equal(m.prop('track-list').filter((x) => x.type === 'audio').length, 2);
  assert.equal(m.prop('track-list').find((x) => x.type === 'audio' && x.id === 2).selected, true);

  await m.attachExternalSubs(9);
  const subs = (await waitProp(m, 'track-list', (v) => v?.some((x) => x.external))).filter((x) => x.type === 'sub');
  assert.ok(subs.find((x) => x.external)?.selected, 'externer Untertitel wurde gewaehlt');

  await m.command('seek', 117, 'absolute');
  await waitProp(m, 'time-pos', (v) => v >= 117);
  await m.setProperty('pause', true);
  const frozen = m.prop('time-pos');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(m.prop('time-pos'), frozen, 'Pause haelt die Zeit an');

  await m.setProperty('pause', false);
  await waitProp(m, 'eof-reached', (v) => v === true, 8000);

  const cmds = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const headers = cmds.find((c) => c.cmd === 'set_property' && c.args[0] === 'http-header-fields');
  assert.deepEqual(headers.args[1], ['Authorization: MediaBrowser Token="t"']);
  assert.ok(cmds.some((c) => c.cmd === 'loadfile' && c.args[0] === 'http://x/video'));
  fs.rmSync(log, { force: true });

  await m.quit();
  assert.equal(m.exited, true);
});

test('mpv-Controller: Fehler wenn der Prozess sofort endet', async () => {
  const m = new MpvPlayer({ exe: process.execPath, spawnPrefix: ['-e', 'process.exit(3)'], args: [], pipe: `\\\\.\\pipe\\jc-none-${process.pid}`, connectTimeoutMs: 3000 });
  await assert.rejects(() => m.start(), /beendet|nicht erreichbar/);
});
