// Misst die Geometrie der Einstellungszeilen (Luecken, ungewoehnliche Hoehen).
const { server } = require('../mock-server');
module.exports = async (ctx) => {
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1280, 800);
  const sections = process.env.SECTIONS ? process.env.SECTIONS.split(',') : ['appearance'];
  for (const sec of sections) {
    await ctx.run(`location.hash = '#/settings/${sec}'`);
    await ctx.wait(1500);
    const info = await ctx.run(`[...document.querySelectorAll('.setting')].map((s) => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(b.height) + 'h@' + Math.round(b.top); };
      const cs = getComputedStyle(s);
      return { row: r(s), text: r(s.querySelector('.setting-text')), ctl: r(s.querySelector('.setting-control')), wide: s.classList.contains('wide'), dir: cs.flexDirection, label: (s.querySelector('.setting-label')?.textContent || '').slice(0, 24) };
    })`);
    console.log(`--- ${sec} ---`);
    for (const i of info.slice(0, 6)) console.log(JSON.stringify(i));
  }
  server.close();
};
