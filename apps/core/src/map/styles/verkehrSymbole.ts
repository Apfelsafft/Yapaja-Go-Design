/**
 * Welches Bild zu welcher Verkehrsmeldung gehört.
 *
 * ─── WARUM DAS EINE EIGENE DATEI IST ────────────────────────────────────────
 * Weil es drei Stellen gibt, die dasselbe wissen müssen: das Blatt
 * (`scripts/generate-sprites.mjs`), die Kartenebene (`apps/web`) und der
 * Wächter, der beides gegeneinander hält. Stünden die Namen als
 * Zeichenketten an jeder dieser Stellen, wäre ein Tippfehler an genau einer
 * davon ein leeres Symbol — und MapLibre sagt dazu NICHTS. Eine Ebene mit
 * einem `icon-image`, das im Blatt fehlt, bleibt schlicht unsichtbar.
 *
 * Dieselbe Falle wie bei den Glyphen (0.3.6, stumme Beschriftung) und bei der
 * fehlenden `sprite`-Quelle. Beide Male hat es Tage gekostet, weil nichts
 * kaputt war — es war nur nichts da.
 */

import type { Verkehrsmeldung } from '../../online/autobahn.js';

/**
 * Die Arten, für die es ein Bild gibt.
 *
 * Bewusst nicht alle aus `AUTOBAHN_DIENSTE`: abgefragt werden für die Karte
 * nur Baustellen und Sperrungen (siehe `online/verkehr.ts`,
 * `VERKEHR_DIENSTE`). Was nicht abgefragt wird, braucht kein Bild.
 */
export const VERKEHR_SYMBOLE = {
  baustelle: 'verkehr-baustelle',
  sperrung: 'verkehr-sperrung',
} as const;

export type VerkehrArt = keyof typeof VERKEHR_SYMBOLE;

/** Jedes Bild, das für die Verkehrslage ausgeliefert wird. */
export const VERKEHR_ICONS: readonly string[] = Object.values(VERKEHR_SYMBOLE);

/**
 * Das Bild zu einer Meldung — oder `null`.
 *
 * `null` heißt „dafür gibt es kein Symbol", und die Ebene lässt den Punkt
 * dann weg. Ein Ersatzsymbol wäre hier falsch: ein Zeichen, das niemand
 * deuten kann, ist auf einer Karte schlimmer als eine Lücke, weil es
 * Aufmerksamkeit kostet und nichts dafür gibt.
 */
export function symbolFuer(meldung: Pick<Verkehrsmeldung, 'art'>): string | null {
  return (VERKEHR_SYMBOLE as Record<string, string>)[meldung.art] ?? null;
}

/**
 * Wie die Art in der Oberfläche heißt.
 *
 * Getrennt vom Symbolnamen: das eine ist eine Datei, das andere ein Wort für
 * einen Menschen. Sie zusammenzulegen hätte schon einmal dazu geführt, dass
 * ein Bezeichner in der Anzeige stand.
 */
export const VERKEHR_BEZEICHNUNG: Record<VerkehrArt, string> = {
  baustelle: 'Baustelle',
  sperrung: 'Sperrung',
};
