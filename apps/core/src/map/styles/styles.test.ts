/**
 * Unit / contract tests for the style system (E01-T4):
 *  - all three shipped styles validate against the real MapLibre style spec
 *  - transform functions (lang / labelScale / poi) change the JSON correctly
 *  - URL rewriting produces a relative, same-origin tile URL
 *  - plausibility: dark background luminance is low, light/contrast high
 */

import { describe, it, expect } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { buildYapajaContrastStyle } from './yapaja-contrast.js';
import { buildYapajaDarkStyle } from './yapaja-dark.js';
import { buildYapajaLightStyle } from './yapaja-light.js';
import { listStyleSummaries, getStyleDocument } from './registry.js';
import { rewriteSourceUrls, tileUrlForRegion } from './rewrite.js';
import { applyStyleOptions, parseStyleOptions } from './options.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import type { MapStyleDocument, SymbolLayer } from './types.js';

const STYLE_BUILDERS: Record<string, () => MapStyleDocument> = {
  'yapaja-light': buildYapajaLightStyle,
  'yapaja-dark': buildYapajaDarkStyle,
  'yapaja-contrast': buildYapajaContrastStyle,
};

/** WCAG relative luminance of a `#rrggbb` hex color, in [0, 1]. */
function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(normalized.slice(0, 2), 16));
  const g = channel(parseInt(normalized.slice(2, 4), 16));
  const b = channel(parseInt(normalized.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function backgroundColor(style: MapStyleDocument): string {
  const bg = style.layers.find((l) => l.type === 'background');
  if (!bg || bg.type !== 'background') {
    throw new Error('style has no background layer');
  }
  return bg.paint['background-color'];
}

describe('style spec validation', () => {
  for (const [id, build] of Object.entries(STYLE_BUILDERS)) {
    it(`${id}: validates against the MapLibre style spec (rewritten + no options)`, () => {
      const style = rewriteSourceUrls(build(), 'germany');
      const errors = validateStyleMin(style as unknown as StyleSpecification);
      expect(errors).toEqual([]);
    });

    it(`${id}: validates against the MapLibre style spec (unrewritten, as authored)`, () => {
      const style = build();
      const errors = validateStyleMin(style as unknown as StyleSpecification);
      expect(errors).toEqual([]);
    });

    it(`${id}: validates for every lang/labelScale/poi option combination`, () => {
      const langs = ['name', 'name_de', 'name_en'] as const;
      const scales = ['1.0', '1.2'] as const;
      const densities = ['full', 'reduced', 'off'] as const;
      for (const lang of langs) {
        for (const labelScale of scales) {
          for (const poi of densities) {
            const style = applyStyleOptions(rewriteSourceUrls(build(), 'germany'), {
              lang,
              labelScale,
              poi,
            });
            const errors = validateStyleMin(style as unknown as StyleSpecification);
            expect(errors).toEqual([]);
          }
        }
      }
    });
  }
});

describe('plausibility: dark vs light background luminance', () => {
  it('yapaja-light background is in the light range (luminance > 0.7)', () => {
    expect(relativeLuminance(backgroundColor(buildYapajaLightStyle()))).toBeGreaterThan(0.7);
  });

  it('yapaja-dark background is in the dark range (luminance < 0.3)', () => {
    expect(relativeLuminance(backgroundColor(buildYapajaDarkStyle()))).toBeLessThan(0.3);
  });

  it('yapaja-contrast background is in the light range (luminance > 0.7)', () => {
    expect(relativeLuminance(backgroundColor(buildYapajaContrastStyle()))).toBeGreaterThan(0.7);
  });

  it('yapaja-dark is NOT yapaja-light merely inverted / same background', () => {
    expect(backgroundColor(buildYapajaDarkStyle())).not.toBe(backgroundColor(buildYapajaLightStyle()));
  });
});

describe('yapaja-contrast: reduced POI, thick roads, high contrast baseline', () => {
  /**
   * Die ZUSAGE ist unveraendert -- im Kontraststil muessen Strassen kraeftiger
   * gezeichnet sein. Nur ihre Pruefung folgt der neuen Struktur: seit 0.3.7
   * gibt es nicht mehr eine Ebene `region-transportation` fuer jede Strasse,
   * sondern eine Hierarchie (Autobahn ... Wohnstrasse), und die Breite ist ein
   * Zoom-Ausdruck statt einer Zahl. Verglichen werden deshalb die
   * Breiten-Stuetzstellen, und zwar fuer JEDE Strassenklasse.
   */
  it('roads are thicker than in yapaja-light, across every road class', () => {
    const contrast = buildYapajaContrastStyle().layers;
    const light = buildYapajaLightStyle().layers;

    // `type === 'line'` schliesst `road-labels` aus (eine Symbolebene), und
    // `road-path` ist bewusst NICHT skaliert: der Kontraststil soll befahrbare
    // Strassen betonen, nicht Trampelpfade.
    const roadIds = light
      .filter((l) => l.type === 'line' && l.id.startsWith('road-') && l.id !== 'road-path')
      .map((l) => l.id);
    expect(roadIds.length, 'Vorbedingung: es gibt Strassenebenen zu vergleichen').toBeGreaterThan(4);

    /** Die Zahlen aus einem `['interpolate', ..., zoom, breite, ...]`-Ausdruck. */
    const widths = (layers: typeof light, id: string): number[] => {
      const layer = layers.find((l) => l.id === id);
      expect(layer?.type, `${id} fehlt oder ist keine Linie`).toBe('line');
      const expr = (layer as { paint: Record<string, unknown> }).paint['line-width'];
      expect(Array.isArray(expr), `${id}: line-width ist kein Ausdruck`).toBe(true);
      return (expr as unknown[]).filter((v): v is number => typeof v === 'number');
    };

    for (const id of roadIds) {
      const c = widths(contrast, id);
      const l = widths(light, id);
      expect(c.length).toBe(l.length);
      // Jede Stuetzstelle: Zoomstufen gleich, Breiten groesser.
      for (let i = 0; i < c.length; i += 2) {
        expect(c[i], `${id}: Zoomstufe verschoben`).toBe(l[i]);
        expect(c[i + 1], `${id}: bei Zoom ${c[i]} nicht dicker als im hellen Stil`).toBeGreaterThan(
          l[i + 1],
        );
      }
    }
  });

  it('poi-labels ships with a reduced-class filter by default', () => {
    const poiLayer = buildYapajaContrastStyle().layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(poiLayer.filter).toBeDefined();
    expect(poiLayer.layout.visibility).toBe('visible');
  });
});

describe('registry', () => {
  /** Seit 0.3.7 fuenf statt drei -- auf Wunsch des Betreibers („Koennen wir
   *  eine Auswahl verschiedener Kartenstile anbieten?"). Die Liste steht hier
   *  fest, damit ein Stil nicht versehentlich verschwindet: die Oberflaeche
   *  zeigt genau das, was die Registry meldet. */
  it('lists exactly the five shipped styles', () => {
    const summaries = listStyleSummaries();
    expect(summaries.map((s) => s.id).sort()).toEqual([
      'yapaja-contrast',
      'yapaja-dark',
      'yapaja-light',
      'yapaja-minimal',
      'yapaja-outdoor',
    ]);
    for (const summary of summaries) {
      expect(summary.name).toBeTruthy();
    }
  });

  it('getStyleDocument returns null for an unknown id', () => {
    expect(getStyleDocument('does-not-exist')).toBeNull();
  });

  it('getStyleDocument returns a fresh object each call (no shared mutable state)', () => {
    const a = getStyleDocument('yapaja-light');
    const b = getStyleDocument('yapaja-light');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('rewriteSourceUrls', () => {
  it('rewrites the vector source URL to a relative, page-relative tile URL', () => {
    const style = rewriteSourceUrls(buildYapajaLightStyle(), 'germany');
    const source = style.sources[REGION_SOURCE_ID];
    expect(source.url).toBe('pmtiles://./tiles/germany.pmtiles');
  });

  it('never leaves the placeholder URL in a rewritten style', () => {
    const style = rewriteSourceUrls(buildYapajaLightStyle(), 'germany');
    expect(JSON.stringify(style)).not.toContain(PLACEHOLDER_TILE_URL);
  });

  it('the rewritten URL is same-origin-safe: no host, no scheme other than pmtiles://', () => {
    const url = tileUrlForRegion('germany');
    expect(url.startsWith('pmtiles://./')).toBe(true);
    expect(url).not.toMatch(/^pmtiles:\/\/https?:/);
    expect(url).not.toContain('://http');
  });

  it('is per-region: different regions produce different URLs', () => {
    const a = rewriteSourceUrls(buildYapajaLightStyle(), 'germany');
    const b = rewriteSourceUrls(buildYapajaLightStyle(), 'france');
    expect(a.sources[REGION_SOURCE_ID].url).not.toBe(b.sources[REGION_SOURCE_ID].url);
  });

  it('does not mutate the input style document', () => {
    const original = buildYapajaLightStyle();
    const originalUrl = original.sources[REGION_SOURCE_ID].url;
    rewriteSourceUrls(original, 'germany');
    expect(original.sources[REGION_SOURCE_ID].url).toBe(originalUrl);
  });
});

describe('parseStyleOptions', () => {
  it('parses all three valid options', () => {
    expect(parseStyleOptions({ lang: 'name_de', labelScale: '1.2', poi: 'reduced' })).toEqual({
      lang: 'name_de',
      labelScale: '1.2',
      poi: 'reduced',
    });
  });

  it('drops unknown/invalid values instead of throwing', () => {
    expect(parseStyleOptions({ lang: 'klingon', labelScale: '99', poi: 'lots' })).toEqual({});
  });

  it('omits keys entirely absent from the query', () => {
    expect(parseStyleOptions({})).toEqual({});
    expect(parseStyleOptions({ lang: 'name_en' })).toEqual({ lang: 'name_en' });
  });
});

describe('applyStyleOptions: lang', () => {
  it('rewrites text-field on every label layer to ["get", lang]', () => {
    const style = applyStyleOptions(buildYapajaLightStyle(), { lang: 'name_de' });
    const placeLabels = style.layers.find((l) => l.id === 'place-labels') as SymbolLayer;
    const poiLabels = style.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(placeLabels.layout['text-field']).toEqual(['get', 'name_de']);
    expect(poiLabels.layout['text-field']).toEqual(['get', 'name_de']);
  });

  it('does not touch non-symbol layers', () => {
    const before = buildYapajaLightStyle();
    const after = applyStyleOptions(before, { lang: 'name_en' });
    const beforeRoad = before.layers.find((l) => l.id === 'region-transportation');
    const afterRoad = after.layers.find((l) => l.id === 'region-transportation');
    expect(afterRoad).toEqual(beforeRoad);
  });

  it('leaves text-field untouched when lang is not provided', () => {
    const before = buildYapajaLightStyle();
    const after = applyStyleOptions(before, {});
    expect(after).toEqual(before);
  });
});

describe('applyStyleOptions: labelScale', () => {
  it('1.2 scales text-size up by 20% on every label layer', () => {
    const base = buildYapajaLightStyle();
    const basePlaceSize = (base.layers.find((l) => l.id === 'place-labels') as SymbolLayer).layout['text-size'] as number;
    const basePoiSize = (base.layers.find((l) => l.id === 'poi-labels') as SymbolLayer).layout['text-size'] as number;

    const scaled = applyStyleOptions(base, { labelScale: '1.2' });
    const placeLabels = scaled.layers.find((l) => l.id === 'place-labels') as SymbolLayer;
    const poiLabels = scaled.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;

    expect(placeLabels.layout['text-size']).toBeCloseTo(basePlaceSize * 1.2, 5);
    expect(poiLabels.layout['text-size']).toBeCloseTo(basePoiSize * 1.2, 5);
  });

  it('1.0 leaves text-size unchanged', () => {
    const base = buildYapajaLightStyle();
    const scaled = applyStyleOptions(base, { labelScale: '1.0' });
    const before = (base.layers.find((l) => l.id === 'place-labels') as SymbolLayer).layout['text-size'];
    const after = (scaled.layers.find((l) => l.id === 'place-labels') as SymbolLayer).layout['text-size'];
    expect(after).toBe(before);
  });
});

describe('applyStyleOptions: poi', () => {
  it('off hides the poi-labels layer and drops any filter', () => {
    const style = applyStyleOptions(buildYapajaContrastStyle(), { poi: 'off' });
    const poiLabels = style.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(poiLabels.layout.visibility).toBe('none');
    expect(poiLabels.filter).toBeUndefined();
  });

  it('full shows the poi-labels layer with no class filter', () => {
    const style = applyStyleOptions(buildYapajaContrastStyle(), { poi: 'full' });
    const poiLabels = style.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(poiLabels.layout.visibility).toBe('visible');
    expect(poiLabels.filter).toBeUndefined();
  });

  it('reduced shows the poi-labels layer with a class allowlist filter', () => {
    const style = applyStyleOptions(buildYapajaLightStyle(), { poi: 'reduced' });
    const poiLabels = style.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(poiLabels.layout.visibility).toBe('visible');
    expect(poiLabels.filter).toBeDefined();
  });

  it('does not touch place-labels (not a POI layer)', () => {
    const before = buildYapajaLightStyle();
    const after = applyStyleOptions(before, { poi: 'off' });
    const beforePlace = before.layers.find((l) => l.id === 'place-labels');
    const afterPlace = after.layers.find((l) => l.id === 'place-labels');
    expect(afterPlace).toEqual(beforePlace);
  });

  it('an explicit ?poi=full overrides yapaja-contrast baked-in reduced default', () => {
    const contrastDefault = buildYapajaContrastStyle().layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(contrastDefault.filter).toBeDefined(); // baseline is reduced

    const overridden = applyStyleOptions(buildYapajaContrastStyle(), { poi: 'full' });
    const poiLabels = overridden.layers.find((l) => l.id === 'poi-labels') as SymbolLayer;
    expect(poiLabels.filter).toBeUndefined();
  });
});
