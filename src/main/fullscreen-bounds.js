'use strict';

/**
 * Lage des Steuerungs-Fensters (Overlay) im Vollbild.
 *
 * Das Overlay ist ein eigenes, durchsichtiges Fenster ueber dem Host-Fenster und hat meist den Fokus (also ist es das Vordergrundfenster). Windows blendet die Taskleiste
 * nur aus, wenn das Vordergrundfenster den ganzen Bildschirm bedeckt, auch bei "Taskleiste automatisch ausblenden"; sonst bleibt ein 1 bis 2 Bildpunkte hoher Streifen
 * der Taskleiste am unteren Rand stehen (im Video erst zu sehen, wenn die Leiste nach ein paar Sekunden ausblendet).
 * Fenstergroessen gibt Electron in geraeumigen Einheiten (DIP) an und rundet sie auf ganze Werte, bei gebrochener Skalierung (125 %, 150 %, 175 % ...) kann das Fenster dadurch
 * einen Bildpunkt kuerzer ausfallen als der Bildschirm: genau der Fall, in dem der Streifen bleibt. Darum ragt das Overlay im Vollbild ringsum ein paar Einheiten ueber den Bildschirm
 * hinaus (unsichtbar, es ist durchsichtig; 2 Einheiten sind mindestens 2 Bildpunkte, mehr als jede Rundung wegnimmt).
 */
const FULLSCREEN_MARGIN = 2;

/** Rechteck {x, y, width, height} ringsum um `margin` vergroessert. */
function coverBounds(b, margin = FULLSCREEN_MARGIN) {
  return { x: b.x - margin, y: b.y - margin, width: b.width + margin * 2, height: b.height + margin * 2 };
}

module.exports = { coverBounds, FULLSCREEN_MARGIN };
