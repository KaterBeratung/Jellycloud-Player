import { h } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';

/**
 * Zahl der wartenden Anfragen am Reiter "Anfragen" (Build 98 der Apple-App, 98.7): als Kennzeichen wie das des Systems (roter Kreis mit weisser Zahl), nur fuer
 * ein Seerr-Konto, das Anfragen verwalten darf (sonst meldet die Rueckseite null). Quelle Seerr GET /request/count (pending).
 * Neu gelesen: beim Aufbau des Rahmens, nach einer bestaetigten Verbindung zu Seerr (Start, Rueckkehr, Profilwechsel), nach jeder Aenderung an Anfragen
 * (Genehmigen, Ablehnen, neue Anfrage, Seerr verbunden oder getrennt: "seerr-changed"), beim Oeffnen des Reiters und alle 15 Minuten. Nicht auf dem
 * Fernseher (wie Apple TV).
 * @param {HTMLElement[]} targets die Reiter "Anfragen" (Kapsel am Desktop, Reiterleiste auf dem Handy)
 */
const EVERY_MS = 15 * 60 * 1000;

export function installPendingBadge(targets) {
  let count = 0;
  let seq = 0;
  const profile = state.activeServerId;
  const badges = targets.map((el) => {
    const b = h('span', { class: 'tab-badge', hidden: true, 'aria-hidden': 'true' }, '');
    el.append(b);
    el.dataset.label = el.dataset.label ?? t('nav.requests');
    return b;
  });

  function paint() {
    const n = document.documentElement.dataset.form === 'tv' ? 0 : count;
    // Ohne Zahl kein Text: der Reiter heisst dann nur "Anfragen" (auch fuer textContent und Bildschirmleser)
    badges.forEach((b) => {
      b.hidden = n === 0;
      b.textContent = n === 0 ? '' : n > 99 ? '99+' : String(n);
    });
    targets.forEach((el) => {
      if (n) el.setAttribute('aria-label', t('nav.requestsPending', { label: el.dataset.label, n }));
      else el.removeAttribute('aria-label');
    });
  }

  async function refresh() {
    const mine = ++seq;
    let n = count;
    try {
      const r = await window.jc.seerrPendingCount();
      n = Number.isInteger(r) && r > 0 ? r : 0;
    } catch {
      // nicht erreichbar: die letzte Zahl bleibt, bis Seerr wieder antwortet (wie die Apple-App)
    }
    if (mine !== seq || state.activeServerId !== profile) return;
    count = n;
    paint();
  }

  const onRoute = (e) => {
    if (e.detail?.nav === 'requests') refresh();
  };
  document.addEventListener('seerr-confirmed', refresh);
  document.addEventListener('seerr-changed', refresh);
  document.addEventListener('route', onRoute);
  const timer = setInterval(refresh, EVERY_MS);
  refresh();

  return {
    refresh,
    destroy() {
      seq++;
      clearInterval(timer);
      document.removeEventListener('seerr-confirmed', refresh);
      document.removeEventListener('seerr-changed', refresh);
      document.removeEventListener('route', onRoute);
    }
  };
}
