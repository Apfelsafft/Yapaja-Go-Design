/**
 * Die Schriftschnitte, mit denen die Karte beschriftet wird.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * MapLibre zeichnet ohne `glyphs`-Quelle KEINEN Buchstaben. Bis 0.3.6 hatten
 * unsere Stile keine: sechs Symbol-Ebenen, und nie ein Ortsname auf dem
 * Bildschirm. Im laufenden Browser nachgemessen — `map.getStyle().glyphs` war
 * `null` — und nicht etwa erschlossen.
 *
 * Zwei Wege führen still ins Leere, und beide sehen aus wie „hier gibt es
 * eben nichts zu beschriften":
 *
 *   1. Kein `glyphs` im Stil  → gar kein Text.
 *   2. Ein `text-font`, für das keine Dateien ausgeliefert werden → kein Text
 *      auf genau dieser Ebene, gemeldet nur in der Browserkonsole.
 *
 * Deshalb stehen Name und URL-Vorlage NUR hier, und `baseLayers.fonts.test.ts`
 * prüft gegen die Dateien auf der Platte, dass es zu jedem verwendeten
 * Schriftschnitt auch wirklich Glyphen gibt.
 */

/** Normale Beschriftung: Straßen, Gewässer, kleinere Orte, POIs. */
export const FONT_REGULAR = 'noto-sans-regular';

/** Hervorgehobene Beschriftung: Städte und größere Orte. */
export const FONT_BOLD = 'noto-sans-bold';

/** Jeder Schriftschnitt, für den Glyphen ausgeliefert werden. */
export const SHIPPED_FONTS = [FONT_REGULAR, FONT_BOLD] as const;

/**
 * Die Zeichenbereiche, die im Repo liegen (`apps/web/public/fonts/<schnitt>/`).
 * Muss mit `RANGES` in `scripts/generate-glyphs.mjs` übereinstimmen.
 */
export const FONT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 255],
  [256, 511],
  [512, 767],
  [768, 1023],
  [1024, 1279],
  [7680, 7935],
  [8192, 8447],
];

/**
 * Wo MapLibre die Glyphen holt.
 *
 * SEITENRELATIV, aus demselben Grund wie die Kachel-URL (siehe `rewrite.ts`):
 * Der Stil wird als Daten geladen, nicht angesteuert — es gibt also keine
 * „Stil-URL", gegen die der Browser einen Pfad auflösen könnte. Er löst gegen
 * die SEITE auf. Nur so funktioniert derselbe Stil unter `/` und unter dem
 * HA-Ingress-Unterpfad (W-15), ohne dass der Core den Präfix kennen müsste.
 *
 * Die Dateien liegen in `apps/web/public/fonts/` — Vite kopiert das nach
 * `apps/web/dist`, das Add-on-Image legt es als `apps/core/public` ab, und der
 * Core liefert es unter `/` aus. Kein zusätzlicher Handgriff im Dockerfile.
 */
export const GLYPHS_URL = './fonts/{fontstack}/{range}.pbf';
