/** Globaler UI-Zustand. Kommt aus dem Hauptprozess (ohne Tokens). */
export const state = {
  loggedIn: false,
  isAdmin: false, // das Jellyfin-Konto ist Administrator (Richtlinie des Benutzers): nur dann gibt es die Verwaltung
  servers: [],
  activeServerId: null,
  settings: null,
  appVersion: '',
  locale: 'de',
  platform: 'desktop', // "desktop" | "web" | "ios" | "android" (Rueckseite, extraState); nur im Desktop-Programm gibt es mpv, Autostart, Updates und Discord
  mpv: null,
  views: [],
  deviceId: '',
  autostartSupported: false, // Windows-Autostart nur in der installierten App
  update: null, // Stand der Selbst-Aktualisierung (Hauptprozess, updater.js): status, version, notes, size, received, error ...
  justUpdated: false, // die App wurde eben vom Installer nach einem Update gestartet
  discordBuiltIn: false, // die Discord-Anwendung fuer Rich Presence ist eingebaut: niemand braucht eine eigene Application-ID (Hauptprozess, discord-presence.js)
  seerr: null, // verbundenes Seerr ({ url, mode, userName }), nie mit Zugangsdaten
  audioOut: null // erkanntes Ausgabegeraet und gewaehlte Kanaele (Hauptprozess, audio-output.js)
};

export async function refreshState() {
  const s = await window.jc.getState();
  Object.assign(state, s);
  refreshAudioOut(); // nicht abwarten: die Detailseite liest den Wert erst, wenn er da ist
  return state;
}

export async function refreshAudioOut() {
  try {
    state.audioOut = await window.jc.audioOutput();
  } catch {
    state.audioOut = null;
  }
  return state.audioOut;
}

export async function updateSettings(patch) {
  const next = await window.jc.setSettings(patch);
  state.settings = next;
  return next;
}

export const activeServer = () => state.servers.find((s) => s.id === state.activeServerId) ?? null;

/** Bibliotheken, die dieser Client darstellen kann (Video-Inhalte). */
export const SUPPORTED_COLLECTIONS = new Set(['movies', 'tvshows', 'boxsets', 'homevideos', 'musicvideos', 'mixed', undefined, null, '']);
