/**
 * Für den Vergleich in der Rangfolge: Groß-/Kleinschreibung, ß und Umlaute
 * zählen nicht.
 */
export function faltung(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
}
