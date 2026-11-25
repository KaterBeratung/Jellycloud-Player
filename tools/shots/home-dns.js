// Heimnetz ueber das DNS (1.2.31): Ein Name, der nicht schon dem Namen nach lokal ist (".int", eigene Domain mit Split-DNS), gilt als Heimnetz, wenn er
//   laut DNS des Rechners auf eine private Adresse zeigt. Nachgestellt mit "localtest.me" (oeffentlicher Name, loest auf 127.0.0.1 auf): der Testserver
//   nennt keine Heimadresse (/System/Info/Public ohne LocalAddress), ohne die DNS-Pruefung ergaebe das "Internet" mit der Grenze des Servers.
//   Ohne Namensaufloesung (kein Netz) wird das Szenario uebersprungen. Port 8965.
const dns = require('node:dns').promises;
const { server, state } = require('../mock-server');

module.exports = async (ctx) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const NAME = 'localtest.me';
  const resolved = await dns.lookup(NAME, { all: true }).then((l) => l.map((a) => a.address)).catch(() => []);
  if (!resolved.includes('127.0.0.1')) {
    console.log(`SKIP  ${NAME} loest nicht auf 127.0.0.1 auf (${resolved.join(', ') || 'kein DNS'})`);
    return;
  }
  await new Promise((r) => server.listen(8965, '127.0.0.1', r));
  // Server stuft die Verbindung als lokal ein (Reverse Proxy) und setzt ueber das Internet 11 Mbit/s
  Object.assign(state.limits, { local: true, user: 11_000_000, server: 0, serverForbidden: false, endpointMissing: false, meMissing: false });
  await ctx.run(`window.jc.login({url:'http://${NAME}:8965', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const page = (js) => ctx.run(js);
  state.log.length = 0; // die Anmeldung fragt selbst /Users/Me; gezaehlt wird nur die Pruefung
  const limits = await page(`window.jc.streamingLimits(true)`);
  check('Name mit privater Adresse laut DNS: Heimnetz', limits?.home === true, JSON.stringify(limits));
  check('...ohne Grenze', limits?.limitBps === 0);
  const asked = state.log.map((l) => l.at);
  check('...ohne Abfrage der Grenzen', !asked.includes('/Users/Me') && !asked.includes('/System/Configuration'), asked.filter((a) => a.startsWith('/System') || a.startsWith('/Users')).join(', '));
  await page(`location.hash = '#/settings/network'`);
  await ctx.wait(1500);
  const text = await page(`document.querySelector('.limit-text')?.textContent ?? ''`);
  check('Einstellungen zeigen "Heimnetz"', /Heimnetz/.test(text), text);

  // Server sagt "entfernt" (eigenes LAN-Netz am Server, VPN): gilt immer, auch wenn der Name privat aufloest
  state.limits.local = false;
  const remote = await page(`window.jc.streamingLimits(true)`);
  check('Server sagt "entfernt": Internet mit Grenze', remote?.home === false && remote?.limitBps === 11_000_000, JSON.stringify(remote));
  state.limits.local = true;

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
