/**
 * Kompakte Ansicht (Handy): gilt nur ausserhalb des Desktop-Programms (data-platform ist dort "desktop") und nur bei schmalem Fenster
 * oder liegendem Handy (niedrig und Touch). Setzt <html data-compact="on|off">; alles Weitere regelt der Abschnitt "Kompakte Ansicht" in app.css
 * (Tab-Leiste unten, schmale Kopfleiste, gestapelte Detailseite, kein Scrollbalken).
 * Im Windows-Programm tut das Modul nichts: das Aussehen dort bleibt unveraendert.
 */
export const COMPACT_QUERY = '(max-width: 820px), (max-height: 500px) and (pointer: coarse)';

export function installCompact() {
  const root = document.documentElement;
  if (root.dataset.platform === 'desktop') return () => {};
  const mq = window.matchMedia(COMPACT_QUERY);
  const apply = () => {
    root.dataset.compact = mq.matches ? 'on' : 'off';
  };
  apply();
  mq.addEventListener('change', apply);
  return () => mq.removeEventListener('change', apply);
}
