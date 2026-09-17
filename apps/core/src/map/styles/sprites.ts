/**
 * Die Bildsymbole der Karte — heute die gerahmten Straßenschilder.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gewuenscht: „Du kannst auch gerne die gerahmten Schilder mit den
 * Bezeichnungen der Strassen einbauen. Blau und gelb."
 *
 * ─── WARUM DIESE DATEI NEBEN `fonts.ts` STEHT ───────────────────────────────
 * Aus demselben Grund, und mit derselben Falle: MapLibre zeichnet ohne
 * `sprite`-Quelle KEIN Symbol, und es sagt das nicht. Eine Ebene mit
 * `icon-image` bleibt dann einfach leer — genau wie die Beschriftung bis
 * 0.3.6 stumm blieb, weil `glyphs` fehlte. Damit das nicht zweimal passiert,
 * steht die URL hier EINMAL, und ein Test haelt sie gegen die Dateien auf der
 * Platte.
 *
 * Es gibt sogar eine dritte Stufe, die still ins Leere fuehrt: ein
 * `icon-image`, das im Blatt nicht vorkommt. Auch das ist kein Fehler,
 * sondern ein fehlendes Bild. Deshalb sind die Namen unten Konstanten und
 * keine Zeichenketten an der Verwendungsstelle.
 *
 * ─── DIE DATEIEN LIEGEN IM REPO ─────────────────────────────────────────────
 * Erzeugt von `scripts/generate-sprites.mjs`, eingecheckt unter
 * `apps/web/public/sprites/`. Nicht beim Bauen erzeugt: das Add-on baut auf
 * dem Geraet des Betreibers, und jeder Schritt dort ist eine Stelle mehr, an
 * der die Installation scheitern kann. Dieselbe Begruendung wie bei den
 * Glyphen.
 */

/**
 * Basisname der Symbolsammlung. MapLibre haengt selbst `.json`/`.png` an und
 * greift bei hoher Pixeldichte zu `@2x` — beides liegt bereit.
 */
export const SPRITE_URL = './sprites/yapaja';

/**
 * Die Schildformen im Blatt. Muss zu `SHIELDS` in
 * `scripts/generate-sprites.mjs` passen; `shieldSprites.test.ts` haelt
 * beides gegeneinander.
 */
export const SHIELD_ICONS = {
  motorway: 'shield-motorway',
  trunk: 'shield-trunk',
  minor: 'shield-minor',
} as const;

/**
 * Die SCHILDER im Blatt — nicht jedes Bild darin.
 *
 * Der Name stand hier frueher als „jedes Symbol, fuer das ein Bild
 * ausgeliefert wird". Das stimmte schon mit der ersten POI-Marke nicht mehr,
 * und seit die Sonderziele aus dem Suchindex dazukommen, erst recht nicht.
 * Wer sich darauf verlaesst, haelt eine Teilmenge fuer das Ganze.
 *
 * Wofuer die Liste wirklich da ist: `shieldSprites.test.ts` prueft mit ihr,
 * dass jedes ausgelieferte SCHILD auch von einer Ebene benutzt wird. Die
 * POI-Marken werden nicht in den Basisebenen genannt, sondern ueber
 * `poiKategorien.ts` und `sonderziele/fehlendeKlassen.ts` zugeordnet; fuer sie
 * gibt es dort eigene Pruefungen in beide Richtungen.
 */
export const SHIPPED_SHIELD_ICONS = Object.values(SHIELD_ICONS);

/** @deprecated Der alte, zu weit klingende Name. Gleicher Inhalt. */
export const SHIPPED_ICONS = SHIPPED_SHIELD_ICONS;

/**
 * Textfarbe je Schild. Sie steht NICHT im Bild — der Text kommt aus den
 * Glyphen und wird von MapLibre eingefaerbt.
 *
 * Weiss auf Autobahnblau, Schwarz auf Gelb und Weiss. Diese Zuordnung ist
 * nicht dekorativ: schwarze Schrift auf dem Blau waere bei Sonne nicht mehr
 * zu lesen, und darum geht es hier.
 */
export const SHIELD_TEXT_COLORS = {
  motorway: '#FFFFFF',
  trunk: '#1A1A1A',
  minor: '#1A1A1A',
} as const;
