import { h } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { pageStatus, showPageStatus } from '../ui.js';

/**
 * Reiter "Anfragen" (wie die Apple-App, Features/Requests/RequestsView.swift). Er steht immer da, auch ohne Seerr: die Leiste aendert ihre
 * Breite nicht beim Einrichten oder Ausfall von Seerr. Ohne Seerr zeigt er den Hinweis mit "Seerr verbinden" (fuehrt in die Einstellungen).
 * Die Uebersicht der Anfragen selbst (Meine Anfragen, Verwalten, offen und abgeschlossen) baut Paket P11 auf diesem Geruest; bis dahin sagt
 * die Seite, wo Titel angefragt werden (Suche).
 */
export function requestsView() {
  const el = h('div', { class: 'page requests', 'data-glow': 'requests' });
  el.append(h('header', { class: 'lib-head' }, h('div', { class: 'lib-title' }, h('h1', null, t('nav.requests')))));
  if (!state.seerr) {
    showPageStatus(el, pageStatus({ kind: 'action', symbol: 'tray', title: t('req.noSeerrTitle'), text: t('req.noSeerrText'), action: { label: t('req.connect'), href: '#/settings/seerr' } }));
  } else {
    showPageStatus(el, pageStatus({ kind: 'action', symbol: 'tray', title: t('req.soonTitle'), text: t('req.soonText'), action: { label: t('req.toSearch'), href: '#/search' } }));
  }
  return { el };
}
