// Autostart (JC_DEV=1): gibt aus, ob das Hauptfenster minimiert gestartet wurde, und prueft das Verhalten der Einstellungen in der Entwicklung.
// Aufruf zweimal: mit und ohne --autostart, in einem Datenordner, dessen config.json autostart + startMinimized auf true setzt.
module.exports = async (ctx) => {
  await ctx.wait(1500);
  const state = await ctx.run(`window.jc.getState()`);
  const argvAuto = process.argv.includes('--autostart');
  console.log(`AUTOSTART argv=${argvAuto} minimiert=${ctx.win.isMinimized()} sichtbar=${ctx.win.isVisible()} unterstuetzt=${state.autostartSupported}`);
  console.log(`AUTOSTART general=${JSON.stringify(ctx.config.settings.general)} bounds=${JSON.stringify(ctx.win.getBounds())}`);
  // In der Entwicklung (nicht installiert) darf das Umschalten nichts in die Registry schreiben und nicht scheitern
  const s = await ctx.run(`window.jc.setSettings({ general: { autostart: true } })`);
  console.log(`AUTOSTART setSettings=${s.general.autostart}`);
};
