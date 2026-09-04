/**
 * Die zweite Zeile eines Suchvorschlags.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Gemeldet: „Wenn ich Rewe eintippe und er mehrere Rewe in meinem Umkreis
 * findet, dann gib bitte die Adresse und ungefähre Entfernung mit an. Wenn ich
 * Beethoven eintippe, gib bitte den Ort mit an."
 *
 * Bis 0.3.8 stand in dieser Zeile `result.label`, und der Lite-Index setzte
 * `label` auf den NAMEN. Jeder Vorschlag zeigte damit denselben Text zweimal
 * untereinander -- drei REWE-Filialen sahen aus wie dreimal dasselbe, und
 * dreihundert Beethovenstraßen erst recht.
 *
 * Die Entfernung steht schon rechts in der Zeile (`SearchBar.tsx`, aus der
 * eigenen Position gerechnet). Hier geht es um WO: Adresse und Ort.
 *
 * ─── WARUM NICHT EINFACH `label` ────────────────────────────────────────────
 * Photon und Nominatim liefern eine fertige, vollstaendige Bezeichnung; die
 * soll unveraendert durchgereicht werden. Der Lite-Index liefert Bausteine.
 * Diese Funktion nimmt, was da ist, und faellt sonst auf `label` zurueck --
 * aber nie auf einen Text, der bloss den Namen wiederholt.
 */

import type { SearchResult } from '@yapaja/shared';

/**
 * Was unter dem Namen steht — oder `null`, wenn es dazu nichts zu sagen gibt.
 *
 * `null` heisst: Zeile weglassen. Eine leere zweite Zeile sieht aus wie ein
 * fehlender Wert, und ein wiederholter Name sieht aus wie ein Fehler.
 */
export function secondaryLine(result: SearchResult): string | null {
  const parts = [result.address, result.locality].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  if (parts.length > 0) {
    return parts.join(', ');
  }

  const label = result.label?.trim();
  if (!label || label === result.name.trim()) {
    return null;
  }
  return label;
}
