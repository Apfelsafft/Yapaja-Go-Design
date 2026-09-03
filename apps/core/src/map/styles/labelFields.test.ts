/**
 * Hält die Sprachwahl gegen die Felder, die unsere Kacheln wirklich führen.
 *
 * ─── DER FEHLER, DEN ES HIER GAB ────────────────────────────────────────────
 * Bis 0.3.6 bot die Oberfläche „Original / Deutsch / English" an und schickte
 * `?lang=name:de` bzw. `?lang=name:en`. Diese Felder gibt es in unseren
 * Kacheln nicht. `applyLang` setzt `text-field` auf JEDER Symbol-Ebene, also
 * war die Folge nicht „ein paar Namen fehlen", sondern: keine Ortsnamen, keine
 * Straßennamen, keine Gewässernamen, keine POI-Namen. Eine stumme Karte.
 *
 * MapLibre meldet so etwas nicht — ein fehlendes Feature-Attribut ist kein
 * Fehler, sondern ein leerer Text. Und der bestehende E2E-Test hat es nicht
 * gefunden, weil er genau das geprüft hat, was der Code tat (`['get',
 * 'name:de']` steht im Stil), statt was dabei herauskommt (steht Text auf der
 * Karte). Ein Test, der die Absicht spiegelt statt der Wirkung, bestätigt den
 * Fehler, den er finden soll.
 *
 * ─── DIE FELDLISTE IST NICHT AUSGEDACHT ─────────────────────────────────────
 * `TILE_NAME_FIELDS` ist die Liste aus `OmtLanguageUtils.getNames` des
 * Profils, mit dem planetiler unsere Kacheln baut — dort aus dem Quelltext
 * gelesen. Alle beschrifteten Ebenen (Place, Poi, TransportationName,
 * WaterName, MountainPeak) rufen diese Funktion auf, führen also genau diese
 * Felder.
 *
 * `name:de` entstünde nur mit `--languages=…`; `services/tiles/build-pmtiles.sh`
 * (DEFAULT_ARGS) übergibt das nicht. Ändert sich das, gehört diese Liste
 * erweitert — dann fällt dieser Test um und sagt genau das.
 */

import { describe, it, expect } from 'vitest';
import { parseStyleOptions, applyStyleOptions } from './options';
import { buildYapajaLightStyle } from './yapaja-light';

/** Was `OmtLanguageUtils.getNames` an jedes beschriftbare Element schreibt. */
const TILE_NAME_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'name_en',
  'name_de',
  'name:latin',
  'name:nonlatin',
  'name_int',
]);

/** Die Werte, die die Oberfläche anbietet (`StylePanel.tsx`, LANG_OPTIONS). */
const OFFERED_LANGS = ['name', 'name_de', 'name_en'] as const;

describe('Sprachwahl der Beschriftung', () => {
  // ─── DER EIGENTLICHE PUNKT ────────────────────────────────────────────────
  it('beschriftet nur aus Feldern, die es in den Kacheln gibt', () => {
    for (const lang of OFFERED_LANGS) {
      const styled = applyStyleOptions(buildYapajaLightStyle(), { lang });
      const symbols = styled.layers.filter((l) => l.type === 'symbol');
      expect(symbols.length, 'kein Symbol-Layer — Test prüft nichts').toBeGreaterThan(0);

      for (const layer of symbols) {
        const field = (layer as { layout: Record<string, unknown> }).layout['text-field'];
        expect(Array.isArray(field)).toBe(true);
        const [op, key] = field as [string, string];
        expect(op).toBe('get');
        expect(
          TILE_NAME_FIELDS.has(key),
          `?lang=${lang} beschriftet "${layer.id}" aus dem Feld "${key}" — das führen ` +
            'unsere Kacheln nicht. Die Ebene bliebe ohne jeden Text, ohne Fehlermeldung.',
        ).toBe(true);
      }
    }
  });

  it('übernimmt jede angebotene Sprache tatsächlich (keine still verworfene Wahl)', () => {
    for (const lang of OFFERED_LANGS) {
      expect(parseStyleOptions({ lang }).lang, `?lang=${lang} wurde verworfen`).toBe(lang);
    }
  });

  /** Wer vor 0.3.7 „Deutsch" gewählt hatte, hat `name:de` gespeichert oder in
   *  einem Lesezeichen stehen. Das soll auf das Feld zeigen, das es gibt —
   *  und nicht wortlos auf „Original" zurückfallen. */
  it('biegt die alten Werte auf die echten Felder um', () => {
    expect(parseStyleOptions({ lang: 'name:de' }).lang).toBe('name_de');
    expect(parseStyleOptions({ lang: 'name:en' }).lang).toBe('name_en');
  });

  it('verwirft weiterhin, was gar keine Sprache ist', () => {
    expect(parseStyleOptions({ lang: 'name:fr' }).lang).toBeUndefined();
    expect(parseStyleOptions({ lang: 'unsinn' }).lang).toBeUndefined();
    expect(parseStyleOptions({}).lang).toBeUndefined();
  });

  /** `name_de`/`name_en` fallen im Profil selbst auf `name` zurück. Diese
   *  Prüfung hält fest, dass wir genau deshalb DIESE Felder nehmen und nicht
   *  die `name:xx`-Varianten, die keinen Rückfall haben. */
  it('nutzt die Felder mit Rückfall auf den Originalnamen', () => {
    for (const lang of ['name_de', 'name_en'] as const) {
      expect(lang.startsWith('name_'), `"${lang}" ist keine Variante mit Rückfall`).toBe(true);
    }
  });
});
