/**
 * Was auf den Schildern steht — aufbereitet für eine schmale Kachel.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht nach einer Probefahrt:
 *
 *   „Was mir bei Maps noch gefällt ist die Anzeige was auf den Schildern auf
 *    der Straße steht wenn man abbiegt."
 *
 * Das ist die Auskunft, mit der man die Ansage gegen die Wirklichkeit prüft.
 * „Rechts abbiegen" kann man glauben oder nicht; „26 · A 61 · Ludwigshafen"
 * steht am Straßenrand und ist zu vergleichen.
 *
 * ─── WARUM DAS EINE EIGENE, REINE FUNKTION IST ──────────────────────────────
 * Weil die Auswahl eine ENTSCHEIDUNG ist und keine Formatierung: was kommt
 * zuerst, was fällt weg, wenn der Platz nicht reicht. Im Bauteil wäre sie nur
 * im Browser prüfbar und stünde zwischen Klassennamen.
 */

import type { ManeuverSign, ManeuverSignElement } from '@yapaia/shared';

/**
 * Wie viele Textteile höchstens nebeneinander stehen.
 *
 * Gemessen: auf 390 Bildpunkten bleiben der Kachel 238 (siehe
 * `mapControlLayout.ts`). „A 61 · Ludwigshafen · Mannheim" ist dort schon
 * abgeschnitten. Drei ist die Zahl, bei der im ungünstigen Fall noch etwas
 * zu lesen ist; alles darüber wäre ein Versprechen, das die Breite nicht
 * hält.
 */
export const MAX_TEILE = 3;

/** Was die Kachel vom Schild zeigt. */
export interface SchildAnzeige {
  /** Die Ausfahrtsnummer, z. B. „26" — als eigenes Feld, weil sie ein Kästchen bekommt. */
  nummer: string | null;
  /** Straße und Ziele, in Lesereihenfolge. Leer, wenn es nichts gibt. */
  teile: string[];
}

/**
 * Sortiert nach Häufigkeit auf aufeinanderfolgenden Schildern, absteigend.
 *
 * ─── WARUM NICHT EINFACH DIE REIHENFOLGE AUS DER ANTWORT ────────────────────
 * Weil sie keine Aussage ist. Valhalla liefert die Ziele in der Reihenfolge
 * der OSM-Daten; welches davon das WICHTIGE ist, sagt allein
 * `consecutive_count` — wie oft es auf der Schilderfolge wiederholt wird.
 *
 * Das zählt genau dann, wenn gekürzt wird, und Kürzen ist auf dieser Kachel
 * der Normalfall. Ohne diese Sortierung fiele bei „Ludwigshafen, Speyer,
 * Mannheim" womöglich der Ort weg, der auf jedem Schild steht.
 *
 * Bei Gleichstand bleibt die ursprüngliche Reihenfolge (stabile Sortierung) —
 * ohne Angabe gilt 0, dann ändert sich nichts.
 */
function nachHaeufigkeit(elemente: readonly ManeuverSignElement[]): ManeuverSignElement[] {
  return [...elemente].sort((a, b) => (b.consecutive_count ?? 0) - (a.consecutive_count ?? 0));
}

function texte(elemente: readonly ManeuverSignElement[] | undefined): string[] {
  if (!Array.isArray(elemente)) return [];
  return nachHaeufigkeit(elemente)
    .map((e) => e.text?.trim())
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/**
 * Macht aus Valhallas vier Listen, was auf die Kachel passt.
 *
 * ─── DIE REIHENFOLGE IST DIE DES SCHILDES ───────────────────────────────────
 * Erst die Straße (`exit_branch`, „A 61"), dann wohin sie führt
 * (`exit_toward`, „Ludwigshafen"). Genau so steht es auf dem blauen Schild,
 * und wer vergleicht, sucht in derselben Reihenfolge.
 *
 * `exit_name` — der Name des Kreuzes — steht ganz hinten und fällt als
 * erstes weg: in Europa ist er selten belegt, und wer ihn braucht, hat ihn
 * meist schon auf dem Schild gelesen.
 *
 * `null`, wenn nichts übrig bleibt. Nicht ein leeres Objekt: die Kachel
 * fragt „gibt es ein Schild", und darauf ist „ja, ein leeres" keine Antwort.
 */
export function schildAnzeige(sign: ManeuverSign | null | undefined): SchildAnzeige | null {
  if (!sign || typeof sign !== 'object') return null;

  const nummer = texte(sign.exit_number)[0] ?? null;
  const teile = [...texte(sign.exit_branch), ...texte(sign.exit_toward), ...texte(sign.exit_name)]
    // Doppelte wegwerfen: an manchen Kreuzen steht dieselbe Straße als
    // `branch` UND als `toward`. Zweimal dasselbe zu zeigen kostet genau den
    // Platz, an dem sonst das zweite Ziel stünde.
    .filter((t, i, alle) => alle.indexOf(t) === i)
    .slice(0, MAX_TEILE);

  if (nummer === null && teile.length === 0) return null;
  return { nummer, teile };
}
