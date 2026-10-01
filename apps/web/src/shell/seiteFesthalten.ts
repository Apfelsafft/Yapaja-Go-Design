/**
 * Hält die Seite an ihrem Platz: wird sie doch einmal verschoben, geht sie
 * sofort zurück.
 *
 * `overflow: hidden` auf `html`/`body` (index.css) verhindert das Scrollen mit
 * dem Finger. Nicht verhindert es, dass der Browser selbst schiebt -- etwa um
 * ein angetipptes oder fokussiertes Element „in den Blick" zu holen. WebKit
 * auf dem iPad tut genau das, und dann stand die Kopfzeile mit der Suche
 * außerhalb des Bildes (gemeldet: „ich sehe die Suchzeile am oberen Rand
 * nicht mehr").
 *
 * Gescrollt wird in Yapaia nur INNERHALB von Bereichen (Menü, Listen); diese
 * melden ihr Scrollen an sich selbst, nicht an `window`. Ein Scroll-Ereignis
 * am Fenster ist deshalb immer ein Versehen.
 */
export function seiteFesthalten(fenster: Window = window): () => void {
  const zurueck = (): void => {
    if (fenster.scrollX !== 0 || fenster.scrollY !== 0) fenster.scrollTo(0, 0);
    const wurzel = fenster.document.getElementById('root');
    if (wurzel && wurzel.scrollTop !== 0) wurzel.scrollTop = 0;
  };
  fenster.addEventListener('scroll', zurueck, { passive: true });
  return () => fenster.removeEventListener('scroll', zurueck);
}
