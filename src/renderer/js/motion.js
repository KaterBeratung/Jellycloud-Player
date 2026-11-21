/* Bewegung (wie in der Apple-App, Entscheidung E7): keine eigene Animationsstufe mehr. Allein die Systemeinstellung "Bewegung reduzieren"
   (Windows: Barrierefreiheit > Visuelle Effekte > Animationseffekte; Android: Animationen entfernen) nimmt sie zurueck, und zwar sofort, auch bei offener App.
   Das Wurzelelement traegt data-anim="full" | "reduced"; das CSS (--dur) und die Skripte (Neigen der Karten, Startanimation) lesen es.
   Benutzt von der Oberflaeche (app.js) und vom Player-Overlay (player.js). */
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Hat das System "Bewegung reduzieren" eingeschaltet? */
export const reducedMotion = () => !!query?.matches;

let installed = false;
export function installMotion() {
  if (installed) return;
  installed = true;
  const paint = () => {
    document.documentElement.dataset.anim = reducedMotion() ? 'reduced' : 'full';
  };
  paint();
  query?.addEventListener?.('change', paint);
}
