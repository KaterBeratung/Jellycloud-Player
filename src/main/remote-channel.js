'use strict';

/**
 * Steuerkanal zum Jellyfin-Server unter Windows (Plan P19, wie Playback/RemoteControlChannel.swift der Apple-App): offen nur, solange der Player laeuft.
 * Ueber ihn kommt der Stopp an, den ein anderes Geraet desselben Kontos schickt ("Auf diesem Geraet fortsetzen"): der Player schliesst wie ueber seinen Knopf
 * (zuerst die genaue Stelle an den Server, dann das Ende einer Umsetzung), und das andere Geraet spielt dort weiter.
 * - Beim Oeffnen Steuerung anmelden (SupportsMediaControl), dann verbinden; beim Schliessen trennen und die Steuerung abmelden.
 * - WebSocket `/socket?deviceId=...` mit dem Kopf Authorization (der eingebaute Client von Node in Electron erlaubt Kopfzeilen; geprueft fuer E14); nie das
 *   Token in der Adresse.
 * - ForceKeepAlive: Lebenszeichen in der halben Frist. Abbruch: neu nach 5 s, bei wiederholtem Scheitern nach 10, 20, 40, dann alle 60 s; stand eine Verbindung,
 *   beginnt die Folge von vorn.
 * - Nur Stop, Pause, Unpause, PlayPause (Ereignis "command"); alles andere und Unlesbares wird uebergangen.
 * Grenzen: kein Proxy des Systems und keine Ausnahme fuer selbst signierte Zertifikate (dann bleibt die Sitzung nicht steuerbar und wird nirgends angeboten).
 */
const { EventEmitter } = require('node:events');
const Rules = require('../shared/remote-channel');

class RemoteChannel extends EventEmitter {
  /**
   * @param {object} [o]
   * @param {(url:string, init:{headers:object}) => WebSocket} [o.connect] neue Verbindung (Standard: der eingebaute WebSocket)
   * @param {(failures:number) => number} [o.retryDelay] Wartezeit vor dem naechsten Versuch in ms (Tests kuerzer)
   * @param {number} [o.keepAliveScale] Faktor auf die Frist der Lebenszeichen (Tests kuerzer)
   */
  constructor({ connect = (url, init) => new WebSocket(url, init), retryDelay = Rules.retryDelay, keepAliveScale = 1 } = {}) {
    super();
    this.connect = connect;
    this.retryDelay = retryDelay;
    this.keepAliveScale = keepAliveScale;
    this.client = null;
    this.socket = null;
    this.generation = 0; // jedes Oeffnen und Schliessen: Ereignisse einer alten Verbindung zaehlen nicht mehr
    this.failures = 0;
    this.retryTimer = null;
    this.pulse = null;
  }

  /** Ist ein Kanal gewuenscht (zwischen open und close)? */
  get wanted() {
    return !!this.client;
  }

  /** Oeffnet den Kanal fuer diesen Client (Steuerung anmelden, dann verbinden); ein offener Kanal zu einem anderen Client wird vorher geschlossen. */
  open(client) {
    if (!client || !client.token || !client.baseUrl) return;
    if (this.client === client) return;
    this.close();
    const mine = ++this.generation;
    this.client = client;
    this.failures = 0;
    Promise.resolve(client.postCapabilities({ mediaControl: true }))
      .catch(() => null)
      .then(() => {
        if (mine === this.generation) this._connect(mine);
      });
  }

  /** Schliesst den Kanal und meldet die Steuerung ab. */
  close() {
    const client = this.client;
    this.generation++;
    this.client = null;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this._stopPulse();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.close(1000);
      } catch {
        /* schon zu */
      }
    }
    if (client) Promise.resolve(client.postCapabilities({ mediaControl: false })).catch(() => null);
  }

  _connect(mine) {
    const client = this.client;
    const url = Rules.channelUrl(client.baseUrl, client.deviceId);
    if (!url) return;
    let s;
    let heard = false; // kam auf dieser Verbindung eine Nachricht an (die Verbindung stand)?
    try {
      s = this.connect(url, { headers: { Authorization: client.authHeader() } });
    } catch {
      return this._retry(mine, false);
    }
    this.socket = s;
    const current = () => mine === this.generation && this.socket === s;
    s.addEventListener('message', (e) => {
      if (!current()) return;
      heard = true;
      if (typeof e.data !== 'string') return;
      const m = Rules.parse(e.data);
      if (m.type === 'keepAlive') this._startPulse(s, m.seconds);
      else if (m.type === 'command') this.emit('command', m.command);
    });
    s.addEventListener('open', () => {
      if (current()) heard = true; // die Verbindung steht (manche Server schicken erst spaeter etwas)
    });
    const ended = () => {
      if (!current()) return;
      this.socket = null;
      this._stopPulse();
      this._retry(mine, heard);
    };
    s.addEventListener('close', ended);
    s.addEventListener('error', ended);
  }

  _retry(mine, connected) {
    if (mine !== this.generation || !this.client) return;
    this.failures = connected ? 0 : this.failures + 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (mine === this.generation && this.client) this._connect(mine);
    }, this.retryDelay(this.failures));
    this.retryTimer.unref?.();
  }

  /** Lebenszeichen in der halben Frist des Servers, sofort das erste. */
  _startPulse(s, seconds) {
    this._stopPulse();
    const send = () => {
      try {
        if (this.socket === s && s.readyState === 1) s.send(Rules.KEEPALIVE);
      } catch {
        /* die Verbindung endet gerade; der Wiederaufbau folgt */
      }
    };
    send();
    this.pulse = setInterval(send, Math.max(1, Math.round((seconds * 1000 * this.keepAliveScale) / 2)));
    this.pulse.unref?.();
  }

  _stopPulse() {
    clearInterval(this.pulse);
    this.pulse = null;
  }
}

module.exports = { RemoteChannel };
