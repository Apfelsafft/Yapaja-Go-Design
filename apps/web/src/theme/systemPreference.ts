/**
 * Was möchte das GERÄT — hell oder dunkel?
 *
 * ─── WARUM DAS EIN EIGENES MODUL IST ────────────────────────────────────────
 * `resolveTheme.ts` ist bewusst rein: kein `Date.now()`, kein DOM. Genau
 * deshalb lässt sich dort jede Betriebsart als schlichter Unit-Test prüfen.
 * Das Befragen des Geräts ist aber unvermeidlich unrein — also liegt es hier
 * und wird als Wert HINEINGEREICHT, nicht drinnen abgefragt.
 *
 * `null` heißt „nicht feststellbar": ein Browser ohne `matchMedia` oder der
 * Testrenderer. `resolveTheme` macht daraus Hell — nicht die Uhr, denn wer
 * „wie das Gerät" wählt, soll keine dritte, ungenannte Betriebsart bekommen.
 */

const ABFRAGE = '(prefers-color-scheme: dark)';

function medienabfrage(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(ABFRAGE);
  } catch {
    // Manche eingebettete Browser werfen bei unbekannten Abfragen.
    return null;
  }
}

/** Der aktuelle Wunsch des Geräts, oder `null`, wenn er sich nicht feststellen lässt. */
export function systemBevorzugtDunkel(): boolean | null {
  const liste = medienabfrage();
  return liste ? liste.matches : null;
}

/**
 * Horcht auf einen WECHSEL der Geräteeinstellung.
 *
 * Der Modus „system" hat kein `nextBoundaryAt` — das Gerät wechselt auf
 * Zuruf, nicht zu einer vorhersagbaren Uhrzeit. Ohne diesen Horcher bliebe
 * die Karte hell, bis zufällig ein anderer Takt die Auflösung neu bildet.
 * Gibt eine Abmeldefunktion zurück.
 */
export function beiSystemwechsel(rueckruf: (bevorzugtDunkel: boolean) => void): () => void {
  const liste = medienabfrage();
  if (!liste) return () => undefined;
  const behandeln = (ereignis: MediaQueryListEvent): void => rueckruf(ereignis.matches);
  liste.addEventListener('change', behandeln);
  return () => liste.removeEventListener('change', behandeln);
}
