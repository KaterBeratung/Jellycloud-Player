import { h } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { pageStatus, showPageStatus } from '../ui.js';
import { seerrState, runSeerrCheck } from '../connection.js';

/**
 * Reiter "Anfragen" (wie die Apple-App, Features/Requests/RequestsView.swift). Er steht immer da, auch ohne Seerr: die Leiste aendert ihre
 * Breite nicht beim Einrichten oder Ausfall von Seerr. Vier Zustaende (Notiz seerr-integration, "Verhalten"): nicht eingerichtet ("Seerr verbinden"),
 * verbunden, nicht erreichbar ("Erneut versuchen"), Anmeldung abgelaufen ("Erneut anmelden"); ein Ausfall loescht nichts. Der Stand kommt aus der
 * Verbindungspruefung (connection.js), die Seite folgt ihm von selbst.
 * Die Uebersicht der Anfragen selbst (Meine Anfragen, Verwalten, offen und abgeschlossen) baut Paket P11 auf diesem Geruest; bis dahin sagt
 * die Seite im verbundenen Zustand, wo Titel angefragt werden (Suche).
 */
export function requestsView() {
  const el = h('div', { class: 'page requests', 'data-glow': 'requests' });
  el.append(h('header', { class: 'lib-head' }, h('div', { class: 'lib-title' }, h('h1', null, t('nav.requests')))));
  const retry = () => runSeerrCheck();
  const statusFor = (s) => {
    switch (s) {
      case 'none':
        return pageStatus({ kind: 'action', symbol: 'tray', title: t('req.noSeerrTitle'), text: t('req.noSeerrText'), action: { label: t('req.connect'), href: '#/settings/seerr' } });
      case 'checking':
        return pageStatus({ kind: 'loading', title: t('req.checking') });
      case 'unreachable':
        return pageStatus({ kind: 'failed', symbol: 'warning', title: t('req.unreachableTitle'), text: t('req.unreachableText'), retry });
      case 'unauthorized':
        return pageStatus({ kind: 'action', symbol: 'key-off', title: t('req.expiredTitle'), text: t('req.expiredText'), action: { label: t('req.signInAgain'), href: '#/settings/seerr' } });
      case 'failed':
        return pageStatus({ kind: 'failed', title: t('req.failedTitle'), text: t('req.failedText'), retry });
      default:
        return pageStatus({ kind: 'action', symbol: 'tray', title: t('req.soonTitle'), text: t('req.soonText'), action: { label: t('req.toSearch'), href: '#/search' } });
    }
  };
  let shown = null;
  const paint = () => {
    const s = seerrState();
    if (s === shown) return; // gleicher Stand: nichts neu aufbauen (der Fokus bleibt, wo er ist)
    shown = s;
    showPageStatus(el, statusFor(s));
  };
  paint();
  document.addEventListener('connection-state', paint);
  // Beim Oeffnen den Stand bei Seerr nachsehen (still, wenn schon verbunden, wie die Seerr-Einstellungen der Apple-App); die Uebersicht aus P11
  // ersetzt das durch das Laden der Anfragen selbst
  if (state.seerr) runSeerrCheck({ quiet: seerrState() === 'connected' });
  return {
    el,
    destroy() {
      document.removeEventListener('connection-state', paint);
    }
  };
}
