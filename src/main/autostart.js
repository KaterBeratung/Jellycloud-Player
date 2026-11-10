'use strict';

/**
 * Windows-Autostart ueber die Anmeldeobjekte von Electron (HKCU\Software\Microsoft\Windows\CurrentVersion\Run).
 * Alles nimmt das `app`-Objekt als Parameter, damit sich die Logik ohne echten Registry-Eintrag testen laesst.
 */

/** Argument, mit dem Windows die App beim Anmelden startet. Daran erkennt sie den Autostart (und startet auf Wunsch minimiert). */
const AUTOSTART_ARG = '--autostart';

/** Autostart gibt es nur in der installierten Windows-App: in der Entwicklung wuerde sonst electron.exe selbst eingetragen. */
function autostartSupported(app, platform = process.platform) {
  return platform === 'win32' && !!app?.isPackaged;
}

/** Traegt die App in den Windows-Autostart ein bzw. aus. @returns {boolean} ob etwas geschrieben wurde */
function setAutostart(app, enabled, { platform = process.platform } = {}) {
  if (!autostartSupported(app, platform)) return false;
  app.setLoginItemSettings({ openAtLogin: !!enabled, args: enabled ? [AUTOSTART_ARG] : [] });
  return true;
}

/**
 * Gleicht den Eintrag beim Start mit der Einstellung ab, etwa nachdem die App in einen anderen Ordner installiert wurde
 * (dann stimmt der Pfad im Eintrag nicht mehr). Schreibt nur bei Abweichung.
 * @returns {boolean} ob etwas geschrieben wurde
 */
function syncAutostart(app, enabled, { platform = process.platform } = {}) {
  if (!autostartSupported(app, platform)) return false;
  const now = !!app.getLoginItemSettings({ args: [AUTOSTART_ARG] }).openAtLogin;
  if (now === !!enabled) return false;
  return setAutostart(app, enabled, { platform });
}

/** Wurde die App von Windows beim Anmelden gestartet? */
function launchedByAutostart(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(AUTOSTART_ARG);
}

/** Beim Autostart nur in die Taskleiste, wenn "Minimiert starten" an ist. Ein normaler Start zeigt das Fenster immer. */
function shouldStartMinimized({ argv = process.argv, general = {} } = {}) {
  return launchedByAutostart(argv) && !!general.autostart && !!general.startMinimized;
}

module.exports = { AUTOSTART_ARG, autostartSupported, setAutostart, syncAutostart, launchedByAutostart, shouldStartMinimized };
