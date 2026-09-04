/**
 * Die aktuelle Geschwindigkeit für die Anzeige.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gewünscht: „Ich hätte gerne überhaupt eine Anzeige der Geschwindigkeit."
 *
 * Bisher gab es keine — weder auf der Karte noch sonstwo in der App. Es gab
 * ein Tempo-Widget für die Widget-Bühne, das aber niemand sieht, und
 * `nav/state.speed_kmh`, das nur während einer laufenden Navigation fließt.
 *
 * Die Anzeige hängt deshalb an der POSITION, nicht an der Navigation: eine
 * Tachoanzeige, die nur während einer geplanten Route funktioniert, wäre
 * keine.
 *
 * ─── WARUM DAS EINE EIGENE DATEI IST ────────────────────────────────────────
 * Die Umrechnung und die Frage „zeigen oder nicht" sind die einzigen Stellen,
 * an denen etwas falsch sein kann — und sie sind ohne Browser prüfbar. Die
 * Komponente daneben ist dann nur noch Darstellung.
 */

/** Unterhalb dessen gilt das Fahrzeug als stehend. */
export const STANDSTILL_KMH = 2;

/**
 * `Position.speed` ist Meter pro Sekunde über Grund (siehe
 * `packages/shared/src/types.ts`). `null`, wenn die Quelle keine
 * Geschwindigkeit liefert — das ist bei manchen Browsern und beim
 * HA-Tracker der Normalfall.
 */
export function speedKmhFromMetersPerSecond(metersPerSecond: number | null | undefined): number | null {
  if (typeof metersPerSecond !== 'number' || !Number.isFinite(metersPerSecond)) return null;
  // Eine negative Geschwindigkeit gibt es nicht; sie käme aus einer kaputten
  // Quelle und darf nicht als Zahl auf dem Tacho landen.
  if (metersPerSecond < 0) return null;
  return Math.round(metersPerSecond * 3.6);
}

/**
 * Was auf dem Tacho steht — oder `null`, wenn nichts angezeigt werden soll.
 *
 * Steht das Fahrzeug, wird `0` gezeigt und nicht ausgeblendet: eine Anzeige,
 * die beim Halten verschwindet und beim Anfahren zurückspringt, wirkt kaputt.
 * Ausgeblendet wird nur, wenn es gar keine Geschwindigkeit GIBT — dann wäre
 * jede Zahl erfunden.
 */
export function displayedSpeedKmh(metersPerSecond: number | null | undefined): number | null {
  const kmh = speedKmhFromMetersPerSecond(metersPerSecond);
  if (kmh === null) return null;
  return kmh < STANDSTILL_KMH ? 0 : kmh;
}
