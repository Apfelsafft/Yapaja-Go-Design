/**
 * Welcher Teil des eigenen Fensters ist WIRKLICH zu sehen?
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Die Ränder sind abgeschnitten. Kannst du bitte die Anzeige so bauen, dass
 * sie immer in den verfügbaren Platz passt? Auch wenn ein Browser mehr Platz
 * braucht oder die Auflösung des Screens geringer ist."
 *
 * Auf dem iPad, in Home Assistant: Kopfzeile oben halb weg, Zoom-Knopf weg,
 * das Zahnrad unten angeschnitten. Yapaia läuft dort in einem Rahmen
 * (`<iframe>` der Ingress-Seite), und der ist HÖHER als das, was davon auf
 * dem Bildschirm steht -- WebKit rechnet `100vh` als größtmögliche Höhe, ohne
 * die Adressleiste. Innerhalb des Rahmens ist davon nichts zu merken: für
 * die App IST der Rahmen das Fenster, und sie füllte ihn brav bis an Ränder,
 * die niemand sieht.
 *
 * 0.21 hatte nur verhindert, dass die App IN ihrem Rahmen verrutscht. Das
 * war die halbe Antwort; der Rahmen selbst steht trotzdem über.
 *
 * ─── WAS HIER GEMESSEN WIRD ─────────────────────────────────────────────────
 * Der Rahmen gehört zu Home Assistant, unter derselben Adresse -- die App darf
 * also nachsehen, wo er im übergeordneten Fenster liegt und wie viel von dem
 * sichtbar ist. Das geht von Fenster zu Fenster nach oben, so weit es der
 * Browser erlaubt. Heraus kommen vier Ränder: so viel ist oben, unten, links
 * und rechts verdeckt. Die App legt ihre Oberfläche nur in das, was übrig
 * bleibt (`App.tsx`, `#yapaia-sicht`).
 *
 * Läuft Yapaia direkt im Browser, gibt es kein übergeordnetes Fenster; dann
 * zählt nur, was der Browser selbst verdeckt (`visualViewport`, etwa die
 * Bildschirmtastatur). Unter fremder Adresse eingebettet verweigert der
 * Browser den Blick nach oben -- dann bleibt alles, wie es war.
 */

export interface Raender {
  oben: number;
  unten: number;
  links: number;
  rechts: number;
}

export const KEINE_RAENDER: Raender = { oben: 0, unten: 0, links: 0, rechts: 0 };

/**
 * Bleibt weniger als das übrig, wird nicht verkleinert. Ist der Rahmen fast
 * ganz aus dem Bild gescrollt, wäre eine briefmarkengroße Karte schlechter
 * als eine, die man zurückscrollen kann.
 */
export const MINDESTMASS_PX = 240;

interface Rechteck {
  oben: number;
  unten: number;
  links: number;
  rechts: number;
}

/** Der Teil eines Fensters, der auf dem Bildschirm steht, in dessen Koordinaten. */
function sichtbarIn(w: Window): Rechteck {
  const vv = w.visualViewport;
  if (vv && vv.height > 0 && vv.width > 0) {
    return { oben: vv.offsetTop, links: vv.offsetLeft, unten: vv.offsetTop + vv.height, rechts: vv.offsetLeft + vv.width };
  }
  return { oben: 0, links: 0, unten: w.innerHeight, rechts: w.innerWidth };
}

function schnitt(a: Rechteck, b: Rechteck): Rechteck {
  return {
    oben: Math.max(a.oben, b.oben),
    links: Math.max(a.links, b.links),
    unten: Math.min(a.unten, b.unten),
    rechts: Math.min(a.rechts, b.rechts),
  };
}

/** Das übergeordnete Fenster und wo unser Rahmen darin beginnt -- oder `null`. */
function eineEbeneHoeher(w: Window): { eltern: Window; x: number; y: number } | null {
  try {
    if (w.parent === w) return null;
    const rahmen = w.frameElement as HTMLElement | null;
    if (!rahmen) return null; // fremde Adresse: der Browser verrät nichts
    const r = rahmen.getBoundingClientRect();
    return { eltern: w.parent, x: r.left + (rahmen.clientLeft || 0), y: r.top + (rahmen.clientTop || 0) };
  } catch {
    return null;
  }
}

/** Wie viel vom eigenen Fenster an jedem Rand verdeckt ist. */
export function berechneRaender(fenster: Window): Raender {
  const breite = fenster.innerWidth;
  const hoehe = fenster.innerHeight;
  if (!(breite > 0 && hoehe > 0)) return KEINE_RAENDER;

  // In den Koordinaten des JEWEILIGEN Fensters; `versatz` ist, wo unser
  // Fenster darin beginnt.
  let sicht = sichtbarIn(fenster);
  let w = fenster;
  let versatzX = 0;
  let versatzY = 0;
  for (let tiefe = 0; tiefe < 8; tiefe++) {
    const hoch = eineEbeneHoeher(w);
    if (!hoch) break;
    versatzX += hoch.x;
    versatzY += hoch.y;
    // In die Koordinaten des Elternfensters wechseln und mit dem
    // schneiden, was DORT zu sehen ist.
    sicht = schnitt(
      { oben: sicht.oben + hoch.y, unten: sicht.unten + hoch.y, links: sicht.links + hoch.x, rechts: sicht.rechts + hoch.x },
      sichtbarIn(hoch.eltern),
    );
    w = hoch.eltern;
  }
  // Zurück in unsere eigenen Koordinaten.
  const eigen = {
    oben: sicht.oben - versatzY,
    unten: sicht.unten - versatzY,
    links: sicht.links - versatzX,
    rechts: sicht.rechts - versatzX,
  };

  const raender: Raender = {
    oben: Math.max(0, Math.round(eigen.oben)),
    links: Math.max(0, Math.round(eigen.links)),
    unten: Math.max(0, Math.round(hoehe - eigen.unten)),
    rechts: Math.max(0, Math.round(breite - eigen.rechts)),
  };
  if (hoehe - raender.oben - raender.unten < MINDESTMASS_PX) return KEINE_RAENDER;
  if (breite - raender.links - raender.rechts < MINDESTMASS_PX) return KEINE_RAENDER;
  return raender;
}

/**
 * Schreibt die Ränder als CSS-Variablen an `<html>` und hält sie aktuell:
 * bei Größenänderung und Scrollen in JEDEM erreichbaren Fenster darüber.
 *
 * Dazu eine langsame Nachkontrolle alle zwei Sekunden. Home Assistant scrollt
 * in Elementen tief im Shadow-DOM; ob deren Scroll-Ereignisse bis zu einem
 * Zuhörer am Fenster durchkommen, hängt vom Browser ab. Eine Messung kostet
 * vier `getBoundingClientRect` -- das ist billiger als eine Kopfzeile, die
 * man nicht erreicht.
 */
export function sichtbarenBereichVerfolgen(fenster: Window = window): () => void {
  const html = fenster.document.documentElement;
  let zuletzt = '';
  let geplant = false;

  const anwenden = (): void => {
    geplant = false;
    const r = berechneRaender(fenster);
    const schluessel = `${r.oben}|${r.unten}|${r.links}|${r.rechts}`;
    if (schluessel === zuletzt) return;
    zuletzt = schluessel;
    html.style.setProperty('--sicht-oben', `${r.oben}px`);
    html.style.setProperty('--sicht-unten', `${r.unten}px`);
    html.style.setProperty('--sicht-links', `${r.links}px`);
    html.style.setProperty('--sicht-rechts', `${r.rechts}px`);
    html.style.setProperty('--sicht-h', `${fenster.innerHeight - r.oben - r.unten}px`);
    html.style.setProperty('--sicht-b', `${fenster.innerWidth - r.links - r.rechts}px`);
  };
  const planen = (): void => {
    if (geplant) return;
    geplant = true;
    fenster.requestAnimationFrame(anwenden);
  };

  const loesen: Array<() => void> = [];
  const hoeren = (ziel: EventTarget | null | undefined, art: string): void => {
    if (!ziel) return;
    ziel.addEventListener(art, planen, { passive: true, capture: true });
    loesen.push(() => ziel.removeEventListener(art, planen, { capture: true }));
  };

  let w: Window = fenster;
  for (let tiefe = 0; tiefe < 8; tiefe++) {
    hoeren(w, 'resize');
    hoeren(w, 'scroll');
    hoeren(w.visualViewport, 'resize');
    hoeren(w.visualViewport, 'scroll');
    const hoch = eineEbeneHoeher(w);
    if (!hoch) break;
    w = hoch.eltern;
  }

  const zeitgeber = fenster.setInterval(planen, 2000);
  anwenden();
  return () => {
    fenster.clearInterval(zeitgeber);
    loesen.forEach((f) => f());
  };
}
