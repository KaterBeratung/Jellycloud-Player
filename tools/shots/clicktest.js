// Echte Mausklicks (Windows-API, nicht per Skript): Zeigt, ob Elemente der Topbar tatsaechlich anklickbar sind.
// Skript-Klicks (element.click()) umgehen die Windows-Trefferpruefung und erkennen "Ziehflaechen", die Klicks verschlucken, nicht.
const { spawnSync, spawn } = require('node:child_process');

/** PowerShell asynchron ausfuehren. Wichtig fuer Maus-Tests: Wuerde der Hauptprozess der App blockieren (spawnSync), koennte das Fenster
 *  weder verschoben werden noch auf Nachrichten antworten. */
function runPs(ps) {
  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', () => resolve(out.trim()));
    setTimeout(() => child.kill(), 25000).unref?.();
  });
}
const { screen } = require('electron');
const { server } = require('../mock-server');

/** Fragt Windows per WM_NCHITTEST, wofuer es einen Punkt haelt: 1 = Inhalt, 2 = Titelleiste (Ziehflaeche) */
function hitTest(hwnd, x, y) {
  const ps = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class H { [DllImport(\"user32.dll\")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'",
    `$l = [IntPtr](((${Math.round(y)} -band 0xFFFF) -shl 16) -bor (${Math.round(x)} -band 0xFFFF))`,
    `[long][H]::SendMessage([IntPtr]${hwnd}, 0x84, [IntPtr]::Zero, $l)`
  ].join('; ');
  return runPs(ps).then(Number);
}

function osDrag(x, y, dx, dy) {
  const ps = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class N { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); }'",
    '[N]::SetProcessDPIAware() | Out-Null',
    `[N]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
    'Start-Sleep -Milliseconds 150',
    '[N]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120',
    ...Array.from({ length: 10 }, (_, i) => `[N]::SetCursorPos(${Math.round(x + (dx * (i + 1)) / 10)}, ${Math.round(y + (dy * (i + 1)) / 10)}) | Out-Null; Start-Sleep -Milliseconds 40`),
    '[N]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 100'
  ].join('; ');
  return runPs(ps);
}

function osClick(x, y, { double = false } = {}) {
  const ps = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); }'",
    '[M]::SetProcessDPIAware() | Out-Null',
    `[M]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
    'Start-Sleep -Milliseconds 120',
    ...Array.from({ length: double ? 2 : 1 }, () => '[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60')
  ].join('; ');
  return runPs(ps);
}

module.exports = async (ctx) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2800);
  ctx.win.setContentSize(1280, 720);
  ctx.win.setPosition(24, 24); // komplett auf dem Bildschirm, sonst liegen rechte Elemente ausserhalb
  ctx.win.setAlwaysOnTop(true);
  ctx.win.focus();
  await ctx.wait(800);

  /** Mittelpunkt eines Elements in physischen Bildschirmpixeln */
  const centerOf = async (selector) => {
    const r = await ctx.run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) return null;
    const cb = ctx.win.getContentBounds();
    const sp = screen.dipToScreenPoint({ x: cb.x + r.x, y: cb.y + r.y });
    return { ...sp, cx: r.x, cy: r.y };
  };
  /** Welches Element liegt wirklich unter dem Mauszeiger? (deckt verdeckende Elemente auf) */
  const under = (q) => ctx.run(`(() => { const e = document.elementFromPoint(${q.cx}, ${q.cy}); return e ? (e.className || e.tagName) + '' : null; })()`);
  const hash = () => ctx.run('location.hash');
  const wa = screen.getPrimaryDisplay().workArea;
  console.log('Fenster:', JSON.stringify(ctx.win.getBounds()), ' Arbeitsbereich:', JSON.stringify(wa), ' Skalierung:', screen.getPrimaryDisplay().scaleFactor);
  const go = async (h) => {
    await ctx.run(`location.hash = ${JSON.stringify(h)}`);
    await ctx.wait(900);
  };

  const libs = await ctx.run(`[...document.querySelectorAll('.nav-link')].map((a) => a.getAttribute('href'))`);

  // 1) Navigation: auf "Filme" klicken
  await go('#/search');
  let p = await centerOf(`.nav-link[href="${libs[1]}"]`);
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf Navigation "Filme"', (await hash()) === libs[1], await hash());

  // 2) Marke: zurueck zur Startseite
  await go('#/search');
  p = await centerOf('.brand');
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf die Marke "Jellycloud" -> Start', (await hash()) === '#/home', await hash());

  // 3) Navigation "Start" (erster Eintrag)
  await go(libs[1]);
  p = await centerOf(`.nav-link[href="${libs[0]}"]`);
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf Navigation "Start"', (await hash()) === libs[0], await hash());

  // 4) Suche, Einstellungen
  await go('#/home');
  p = await centerOf('.tool[href="#/search"]');
  const lupeUnder = await under(p);
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf Suche (Lupe)', (await hash()).startsWith('#/search'), `${await hash()} - darunter: ${lupeUnder}`);
  p = await centerOf('.tool[href="#/settings"]');
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf Einstellungen', (await hash()).startsWith('#/settings'), await hash());
  p = await centerOf('.who');
  await osClick(p.x, p.y);
  await ctx.wait(900);
  check('Klick auf das Konto', (await hash()) === '#/settings/account', await hash());

  // 5) Der freie Bereich der Leiste bleibt Ziehflaeche: Fenster per Maus verschieben
  await go('#/home');
  const hwnd = ctx.win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  for (const sel of ['.titlebar', '.navrow-start > .grow', '.navpill', '.tool[href="#/search"]']) {
    const q = await centerOf(sel);
    console.log('Trefferpruefung', sel, '->', await hitTest(hwnd, q.x, q.y), '(1 = Inhalt, 2 = Ziehflaeche)');
  }
  const before = ctx.win.getPosition();
  p = await centerOf('.titlebar');
  await osDrag(p.x, p.y, 120, 70);
  await ctx.wait(600);
  const after = ctx.win.getPosition();
  check('Fenster laesst sich am freien Bereich der Leiste ziehen', Math.abs(after[0] - before[0]) > 40 && Math.abs(after[1] - before[1]) > 20, `${before} -> ${after}`);
  ctx.win.setPosition(before[0], before[1]);
  ctx.win.setAlwaysOnTop(false);
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Klicks kamen an`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
