'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTOSTART_ARG, autostartSupported, setAutostart, syncAutostart, launchedByAutostart, shouldStartMinimized } = require('../src/main/autostart');
const { DEFAULT_SETTINGS } = require('../src/main/config');

const fakeApp = ({ packaged = true, openAtLogin = false } = {}) => {
  const calls = [];
  return { isPackaged: packaged, calls, setLoginItemSettings: (o) => calls.push(o), getLoginItemSettings: () => ({ openAtLogin }) };
};

test('Autostart gibt es nur in der installierten Windows-App', () => {
  assert.equal(autostartSupported(fakeApp(), 'win32'), true);
  assert.equal(autostartSupported(fakeApp({ packaged: false }), 'win32'), false, 'in der Entwicklung wuerde electron.exe eingetragen');
  assert.equal(autostartSupported(fakeApp(), 'linux'), false);
  const dev = fakeApp({ packaged: false });
  assert.equal(setAutostart(dev, true, { platform: 'win32' }), false);
  assert.deepEqual(dev.calls, [], 'nichts wird geschrieben');
});

test('Ein- und Ausschalten schreibt den Eintrag mit dem Autostart-Argument', () => {
  const app = fakeApp();
  assert.equal(setAutostart(app, true, { platform: 'win32' }), true);
  assert.deepEqual(app.calls.at(-1), { openAtLogin: true, args: [AUTOSTART_ARG] });
  setAutostart(app, false, { platform: 'win32' });
  assert.deepEqual(app.calls.at(-1), { openAtLogin: false, args: [] });
});

test('Abgleich beim Start schreibt nur bei Abweichung (z. B. nach Umzug in einen anderen Ordner)', () => {
  const sync = (enabled, registered) => {
    const app = fakeApp({ openAtLogin: registered });
    const wrote = syncAutostart(app, enabled, { platform: 'win32' });
    return { wrote, call: app.calls[0] };
  };
  assert.equal(sync(true, true).wrote, false);
  assert.equal(sync(false, false).wrote, false);
  assert.deepEqual(sync(true, false), { wrote: true, call: { openAtLogin: true, args: [AUTOSTART_ARG] } });
  assert.deepEqual(sync(false, true), { wrote: true, call: { openAtLogin: false, args: [] } });
  assert.equal(syncAutostart(fakeApp({ packaged: false }), true, { platform: 'win32' }), false);
});

test('Minimiert starten nur beim Autostart und nur, wenn beides eingeschaltet ist', () => {
  assert.equal(launchedByAutostart(['app.exe', AUTOSTART_ARG]), true);
  assert.equal(launchedByAutostart(['app.exe']), false);
  const on = { autostart: true, startMinimized: true };
  assert.equal(shouldStartMinimized({ argv: ['x', AUTOSTART_ARG], general: on }), true);
  assert.equal(shouldStartMinimized({ argv: ['x'], general: on }), false, 'normaler Start zeigt das Fenster immer');
  assert.equal(shouldStartMinimized({ argv: ['x', AUTOSTART_ARG], general: { autostart: true, startMinimized: false } }), false);
  assert.equal(shouldStartMinimized({ argv: ['x', AUTOSTART_ARG], general: { autostart: false, startMinimized: true } }), false, 'Autostart in den Einstellungen aus');
});

test('Standard: Autostart aus, bei Autostart minimiert', () => {
  assert.equal(DEFAULT_SETTINGS.general.autostart, false);
  assert.equal(DEFAULT_SETTINGS.general.startMinimized, true);
});
