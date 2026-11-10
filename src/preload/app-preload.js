'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Entpackt { ok, data } der Hauptprozess-Handler und wirft bei Fehlern ein Objekt mit message, status und code.
 * Absichtlich kein Error: Die Context-Bridge kopiert Error-Objekte nur mit ihrer Meldung, "status" (401 = Sitzung abgelaufen,
 * 403 = keine Berechtigung) und "code" kamen in der Oberflaeche nie an. Einfache Objekte werden vollstaendig kopiert.
 */
async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.ok) return r.data;
  throw { name: 'JellycloudError', message: r?.error ?? 'Unbekannter Fehler', status: r?.status ?? 0, code: r?.code ?? null };
}

contextBridge.exposeInMainWorld('jc', {
  getState: () => call('state:get'),
  probeServer: (url) => call('server:probe', url),
  login: (p) => call('auth:login', p),
  quickConnectStart: (url) => call('auth:qc-start', url),
  quickConnectPoll: (p) => call('auth:qc-poll', p),
  logout: () => call('auth:logout'),
  switchServer: (id) => call('auth:switch', id),
  api: (method, ...args) => call('jf:call', method, args),
  setSettings: (patch) => call('settings:set', patch),
  detectMpv: () => call('mpv:detect'),
  audioDevices: () => call('mpv:audio-devices'),
  audioOutput: () => call('audio:output'),
  streamingLimits: (force) => call('server:limits', force),
  seerrConnect: (p) => call('seerr:connect', p),
  seerrDisconnect: () => call('seerr:disconnect'),
  seerrSearch: (query, page) => call('seerr:search', query, page),
  seerrTrending: () => call('seerr:trending'),
  seerrDetails: (req) => call('seerr:details', req),
  seerrRequest: (req) => call('seerr:request', req),
  seerrIssue: (req) => call('seerr:issue', req),
  discordStatus: () => call('discord:status'),
  discordTest: (clientId) => call('discord:test', clientId),
  cacheInfo: () => call('cache:info'),
  clearCache: () => call('cache:clear'),
  resetSettings: () => call('settings:reset'),
  play: (req) => call('player:play', req),
  openExternal: (url) => call('shell:open', url),
  openNotices: () => call('app:notices'),
  setTitleBar: (o) => call('window:titlebar', o),
  checkUpdate: () => call('update:check'),
  downloadUpdate: () => call('update:download'),
  cancelUpdate: () => call('update:cancel'),
  installUpdate: () => call('update:install'),
  onUpdateState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update:state', h);
    return () => ipcRenderer.removeListener('update:state', h);
  },
  onPlayerActive: (cb) => {
    const h = (_e, on) => cb(!!on);
    ipcRenderer.on('player:active', h);
    return () => ipcRenderer.removeListener('player:active', h);
  },
  onPlayerClosed: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('player:closed', h);
    return () => ipcRenderer.removeListener('player:closed', h);
  }
});
