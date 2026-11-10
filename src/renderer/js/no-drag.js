/**
 * Nichts in der Oberflaeche darf sich per Drag and Drop wegziehen lassen (Links, Bilder, Karten waeren sonst als Ziehbild greifbar und liessen sich auf den
 * Desktop oder in andere Programme ablegen), und nichts darf darauf abgelegt werden (eine Datei oder ein Link im Fenster wuerde sonst dorthin navigieren).
 * Texteingaben bleiben ausgenommen: markierten Text darin zu verschieben und Text hineinzuziehen ist dort normal.
 */
export function installNoDrag(doc = document) {
  const inField = (t) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  doc.addEventListener('dragstart', (e) => {
    if (!inField(e.target)) e.preventDefault();
  }, true);
  const refuse = (e) => {
    if (inField(e.target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  doc.addEventListener('dragover', refuse, true);
  doc.addEventListener('drop', refuse, true);
}
