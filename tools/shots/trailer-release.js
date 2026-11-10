// Trailer: nach laengerer Ruhe (Fenster verdeckt oder Trailer aus dem Blick) wird der Player abgebaut, damit der YouTube-Prozess keinen Arbeitsspeicher mehr belegt;
// kurze Pausen setzen denselben Player fort, beim Zurueckkommen beginnt ein neuer (JC_DEV=1). Braucht Netz (YouTube-Einbettung), kein Server noetig.
// Die Ruhezeit steht im echten Programm bei 60 s (REST_RELEASE_MS); hier wird sie ueber die Option restMs auf 1,5 s gesetzt.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer-release.js
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..', '..');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) errors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(60);
    }
    return false;
  };
  const MB = (kb) => Math.round(kb / 1024);
  const privateMb = () => ctx.app.getAppMetrics().reduce((a, p) => a + MB(p.memory.privateBytes ?? 0), 0);
  const ytFrames = () => ctx.win.webContents.mainFrame.framesInSubtree.filter((f) => /youtube-nocookie/.test(f.url)).length;
  const setHidden = (on) => ctx.run(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${on} }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  const probe = () => ctx.run(`(() => { const host = document.querySelector('#tr-test-host'); const l = host.querySelector('.trailer'); const f = l.querySelector('iframe'); return { frames: l.querySelectorAll('iframe').length, mark: f?.dataset.mark ?? null, on: l.classList.contains('on'), has: host.classList.contains('has-trailer'), ctl: !host.querySelector('.trailer-ctl, .tr-sound') ? null : true }; })()`);

  ctx.win.setContentSize(1100, 700);
  await ctx.wait(1500);
  await ctx.run(`(async () => {
    const { createTrailer } = await import('./js/trailer.js');
    const host = document.createElement('div');
    host.id = 'tr-test-host';
    host.style.cssText = 'position:fixed;left:20px;top:20px;width:640px;height:360px;z-index:99999;background:#222;overflow:hidden';
    document.body.append(host);
    window.__tr = createTrailer({ host, videoId: 'aqz-KE-bpKQ', quality: '720', muted: true, delaySec: 0, restMs: 1500, onDone: (why) => { window.__trDone = why; } });
    return true;
  })()`);

  check('Der Trailer laeuft und blendet sich ein', await waitFor(`!!document.querySelector('#tr-test-host .trailer.on')`, 60000));
  await ctx.run(`document.querySelector('#tr-test-host iframe').dataset.mark = 'erster'`);
  await ctx.wait(12000); // der Player puffert in den ersten Sekunden weiter voraus: erst danach ist sein Speicherbedarf aussagekraeftig
  check('Im Hauptprozess gibt es einen YouTube-Rahmen', ytFrames() === 1, `${ytFrames()}`);
  const mbPlaying = privateMb();

  // 1) Nur kurz verdeckt (kuerzer als die Ruhezeit): derselbe Player bleibt
  await setHidden(true);
  await ctx.wait(600);
  await setHidden(false);
  await ctx.wait(2200); // laenger als die Ruhezeit: der Zeitgeber muss mit der Rueckkehr gestoppt worden sein
  const brief = await probe();
  check('Kurz verdeckt: derselbe Player bleibt, auch nach Ablauf der Ruhezeit', brief.frames === 1 && brief.mark === 'erster' && brief.on, JSON.stringify(brief));

  // 2) Laenger verdeckt: erst angehalten (Player da), nach der Ruhezeit abgebaut
  await setHidden(true);
  await ctx.wait(700);
  const held = await probe();
  check('Verdeckt, noch vor Ablauf der Ruhezeit: der Player ist noch da (angehalten)', held.frames === 1 && held.mark === 'erster', JSON.stringify(held));
  await ctx.wait(2200);
  const released = await probe();
  check('Nach der Ruhezeit: der Player ist abgebaut (kein Rahmen)', released.frames === 0, JSON.stringify(released));
  check('Nach der Ruhezeit: Ebene und Seitenzustand sind zurueck (Hintergrundbild sichtbar, keine Knoepfe)', !released.on && !released.has);
  await ctx.wait(1500);
  check('Im Hauptprozess ist der YouTube-Rahmen weg', ytFrames() === 0, `${ytFrames()}`);
  const mbReleased = privateMb();
  console.log(`INFO Arbeitsspeicher (privat, alle Prozesse): ${mbPlaying} MB mit laufendem Trailer, ${mbReleased} MB nach dem Abbau, ${mbPlaying - mbReleased} MB weniger`);
  check('Der Abbau gibt Arbeitsspeicher frei (mindestens 60 MB)', mbPlaying - mbReleased >= 60, `${mbPlaying - mbReleased} MB`);

  // 3) Wieder sichtbar: ein neuer Player beginnt und blendet sich ein
  await setHidden(false);
  check('Wieder sichtbar: ein neuer Player entsteht', await waitFor(`document.querySelectorAll('#tr-test-host iframe').length === 1`, 5000));
  const fresh = await probe();
  check('Der neue Player ist ein anderer (nicht der erste)', fresh.mark === null, JSON.stringify(fresh));
  check('Der neue Trailer blendet sich wieder ein', await waitFor(`!!document.querySelector('#tr-test-host .trailer.on')`, 60000));
  check('Es gibt genau einen YouTube-Rahmen', ytFrames() === 1, `${ytFrames()}`);

  // 4) Aus dem Blick (Host ausserhalb des Fensters) laenger als die Ruhezeit: abgebaut; zurueck: neuer Player
  await ctx.run(`document.querySelector('#tr-test-host').style.top = '-2000px'`);
  check('Aus dem Blick und nach der Ruhezeit: der Player ist abgebaut', await waitFor(`document.querySelectorAll('#tr-test-host iframe').length === 0`, 6000));
  await ctx.run(`document.querySelector('#tr-test-host').style.top = '20px'`);
  check('Zurueck im Blick: ein neuer Player entsteht', await waitFor(`document.querySelectorAll('#tr-test-host iframe').length === 1`, 6000));
  check('... und blendet sich ein', await waitFor(`!!document.querySelector('#tr-test-host .trailer.on')`, 60000));

  // 5) Abbau des ganzen Trailers waehrend ein Ruhezeitgeber laeuft: kein spaeterer Fehler, nichts bleibt zurueck
  await setHidden(true);
  await ctx.wait(300);
  await ctx.run(`window.__tr.destroy()`);
  await ctx.wait(2500);
  check('Nach destroy ist kein Rahmen und keine Ebene mehr da', await ctx.run(`document.querySelectorAll('#tr-test-host iframe, #tr-test-host .trailer').length === 0`));
  check('Nach destroy ist der YouTube-Rahmen im Hauptprozess weg', ytFrames() === 0);
  check('Kein "onDone" durch den Abbau der Ruhezeit', (await ctx.run(`window.__trDone ?? null`)) === null);
  await setHidden(false);

  const code = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'trailer.js'), 'utf8');
  check('Quelltext: Ruhezeit (REST_RELEASE_MS) und release() sind da', /REST_RELEASE_MS\s*=\s*60000/.test(code) && /function release\(\)/.test(code));
  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
