/**
 * Die Schriftgröße der Kartenbeschriftung — 80 % bis 200 %.
 *
 * Gewünscht: „einen Slider für die Labelgröße von 80 % bis 200 %". Bis 0.20
 * gab es genau zwei Stufen, 100 % und 120 %.
 *
 * ─── WARUM EINE ZEICHENKETTE ────────────────────────────────────────────────
 * Der Wert reist als `?labelScale=` in der Stil-Adresse und liegt im Browser
 * gespeichert. Beides sind Zeichenketten, und `1.0` muss dabei `1.0` bleiben
 * und nicht zu `1` werden: die Stil-Adresse ist auch der Schlüssel des
 * Zwischenspeichers, und dieselbe Größe darf nicht unter zwei Namen liegen.
 * Die beiden alten Stufen `1.0` und `1.2` kommen deshalb unverändert heraus —
 * gespeicherte Einstellungen gelten weiter.
 *
 * Kern und Oberfläche rufen DIESE Funktion auf. Prüften beide selbst, könnte
 * die Oberfläche 1.95 anbieten, das der Kern als ungültig verwirft — und die
 * Beschriftung bliebe ohne Meldung bei 100 %.
 */

export const LABEL_GROESSE_MIN = 0.8;
export const LABEL_GROESSE_MAX = 2.0;
/** Schrittweite des Schiebereglers: 10 Prozentpunkte. */
export const LABEL_GROESSE_SCHRITT = 0.1;

/**
 * Macht aus einer Eingabe eine gültige Größe — oder `null`, wenn sie keine
 * Zahl ist. Außerhalb des Bereichs wird an den Rand gesetzt, nicht verworfen:
 * wer 250 % verlangt, will offenbar „so groß wie möglich".
 */
export function labelGroesse(roh: unknown): string | null {
  const zahl = typeof roh === 'number' ? roh : typeof roh === 'string' && roh.trim() !== '' ? Number(roh) : NaN;
  if (!Number.isFinite(zahl)) return null;
  const begrenzt = Math.min(LABEL_GROESSE_MAX, Math.max(LABEL_GROESSE_MIN, zahl));
  const gerastert = Math.round(begrenzt / LABEL_GROESSE_SCHRITT) * LABEL_GROESSE_SCHRITT;
  return gerastert.toFixed(1);
}
