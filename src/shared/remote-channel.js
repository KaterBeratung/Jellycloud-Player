/* Gemeinsames Modul: Regeln des Steuerkanals (Plan P19, Quell-Seite). Waehrend der Wiedergabe haelt die App einen WebSocket zum Jellyfin-Server offen
   (`/socket?deviceId=...`, das Token nur im Kopf Authorization) und meldet Steuerung an (SupportsMediaControl); nur dann fuehrt der Server die Sitzung als
   steuerbar, und ein anderes Geraet desselben Kontos kann sie anhalten und hier weiterspielen. Angenommen werden nur Stop, Pause, Unpause und PlayPause.
   Vorlage: Playback/RemoteControlChannel.swift und HandoffRulesTests der Apple-App, Notizen/wiedergabe-uebernahme-architektur.md (Regeln 1 bis 6).
   Die Verbindung selbst haelt die Huelle (Windows: src/main/remote-channel.js; Android: RemoteChannel.java). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCRemoteChannel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Befehle, die die Quelle annimmt; alles andere (Seek, Play, GeneralCommand ...) uebergeht sie. */
  const COMMANDS = Object.freeze(['Stop', 'Pause', 'Unpause', 'PlayPause']);
  /** Wartezeiten vor einem neuen Verbindungsversuch: erst rasch (kurzer Aussetzer), dann seltener (Server ohne WebSocket, etwa hinter einem Reverse Proxy). */
  const RETRY_DELAYS_MS = Object.freeze([5000, 10000, 20000, 40000, 60000]);
  /** Kleinste Frist fuer Lebenszeichen, die die App annimmt (Sekunden). */
  const MIN_KEEPALIVE_S = 10;
  const KEEPALIVE = '{"MessageType":"KeepAlive"}';

  /**
   * Adresse des Kanals: ws bzw. wss zur Adresse des Servers (auch hinter einem Pfad), nur mit der Geraetekennung; das Token steht nie darin. null ohne
   * gueltige Adresse.
   */
  function channelUrl(baseUrl, deviceId) {
    let u;
    try {
      u = new URL(String(baseUrl || ''));
    } catch {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${path}/socket?deviceId=${encodeURIComponent(String(deviceId || ''))}`;
  }

  /** Liest eine Nachricht des Servers: { type: 'command', command } | { type: 'keepAlive', seconds } | { type: 'other' }; Unlesbares ist "other". */
  function parse(textValue) {
    let o;
    try {
      o = JSON.parse(String(textValue));
    } catch {
      return { type: 'other' };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { type: 'other' };
    if (o.MessageType === 'Playstate') {
      const c = o.Data && typeof o.Data === 'object' ? o.Data.Command : null;
      return COMMANDS.includes(c) ? { type: 'command', command: c } : { type: 'other' };
    }
    if (o.MessageType === 'ForceKeepAlive') return { type: 'keepAlive', seconds: Math.max(MIN_KEEPALIVE_S, Number.isFinite(o.Data) ? o.Data : 60) };
    return { type: 'other' };
  }

  /** Wartezeit vor dem naechsten Versuch nach `failures` gescheiterten Verbindungen in Folge (0: die Verbindung stand). */
  const retryDelay = (failures) => RETRY_DELAYS_MS[Math.min(Math.max(0, failures | 0), RETRY_DELAYS_MS.length - 1)];

  return { COMMANDS, RETRY_DELAYS_MS, MIN_KEEPALIVE_S, KEEPALIVE, channelUrl, parse, retryDelay };
});
