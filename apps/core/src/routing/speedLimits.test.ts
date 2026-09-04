/**
 * Tempolimits aus Valhallas `/trace_attributes`.
 *
 * ─── DIE FAELLE STAMMEN AUS VALHALLAS QUELLTEXT ─────────────────────────────
 * `src/tyr/trace_serializer.cc`: `speed_limit` wird nur geschrieben, wenn
 * Valhalla eins kennt (`> 0`), und der Wert ist die Zeichenkette
 * `"unlimited"`, wenn die Strasse keins hat -- deutsche Autobahn. Beides
 * haette ich aus dem Gedaechtnis falsch gebaut: `Number("unlimited")` ist
 * `NaN`, und ein `NaN` auf einem Verkehrsschild im Fahrzeug ist die falsche
 * Sorte Fehler.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraceAttributesBody,
  speedLimitOf,
  speedSegmentsFromTraceAttributes,
} from './speedLimits';

describe('speedLimitOf', () => {
  it('nimmt eine normale Zahl als km/h', () => {
    expect(speedLimitOf({ speed_limit: 50 })).toBe(50);
    expect(speedLimitOf({ speed_limit: 130 })).toBe(130);
  });

  /** ─── DER FALL, DER NUR IN DEUTSCHLAND VORKOMMT ────────────────────────── */
  it('macht aus "unlimited" KEIN Schild', () => {
    expect(
      speedLimitOf({ speed_limit: 'unlimited' }),
      'eine Autobahn ohne Limit darf kein Schild bekommen -- und schon gar kein NaN',
    ).toBeNull();
  });

  it('macht aus einem fehlenden Limit kein Schild', () => {
    expect(speedLimitOf({})).toBeNull();
    expect(speedLimitOf({ speed_limit: null })).toBeNull();
  });

  /** Fremddaten: alles, was keine plausible Zahl ist, darf nie als Limit im
   *  Fahrzeug erscheinen. */
  it('verwirft Unsinn statt ihn anzuzeigen', () => {
    expect(speedLimitOf({ speed_limit: 0 })).toBeNull();
    expect(speedLimitOf({ speed_limit: -30 })).toBeNull();
    expect(speedLimitOf({ speed_limit: 9999 })).toBeNull();
    expect(speedLimitOf({ speed_limit: 'schnell' })).toBeNull();
    expect(speedLimitOf({ speed_limit: Number.NaN })).toBeNull();
    expect(speedLimitOf({ speed_limit: {} })).toBeNull();
  });
});

describe('speedSegmentsFromTraceAttributes', () => {
  it('macht aus Kanten Abschnitte auf der Route', () => {
    const segments = speedSegmentsFromTraceAttributes({
      edges: [
        { begin_shape_index: 0, end_shape_index: 5, speed_limit: 50 },
        { begin_shape_index: 5, end_shape_index: 9, speed_limit: 100 },
      ],
    });
    expect(segments).toEqual([
      { begin_shape_index: 0, end_shape_index: 5, kmh: 50 },
      { begin_shape_index: 5, end_shape_index: 9, kmh: 100 },
    ]);
  });

  it('laesst Kanten ohne Limit weg, statt sie mit null aufzunehmen', () => {
    const segments = speedSegmentsFromTraceAttributes({
      edges: [
        { begin_shape_index: 0, end_shape_index: 5 },
        { begin_shape_index: 5, end_shape_index: 9, speed_limit: 'unlimited' },
        { begin_shape_index: 9, end_shape_index: 12, speed_limit: 80 },
      ],
    });
    expect(segments).toEqual([{ begin_shape_index: 9, end_shape_index: 12, kmh: 80 }]);
  });

  /** Ein Abschnitt mit vertauschten oder fehlenden Grenzen laege irgendwo --
   *  ein Limit an der falschen Stelle ist schlimmer als keins. */
  it('verwirft Abschnitte mit unbrauchbaren Grenzen', () => {
    const segments = speedSegmentsFromTraceAttributes({
      edges: [
        { begin_shape_index: 9, end_shape_index: 3, speed_limit: 50 },
        { begin_shape_index: 3, end_shape_index: 3, speed_limit: 50 },
        { end_shape_index: 5, speed_limit: 50 },
        { begin_shape_index: -1, end_shape_index: 5, speed_limit: 50 },
        { begin_shape_index: 1.5, end_shape_index: 5, speed_limit: 50 },
      ],
    });
    expect(segments).toEqual([]);
  });

  /** Die Antwort kommt von einem fremden Dienst. Eine unerwartete Form darf
   *  eine fertig berechnete Route nicht zu Fall bringen. */
  it('wirft bei keiner Form, die hereinkommen koennte', () => {
    expect(speedSegmentsFromTraceAttributes(null)).toEqual([]);
    expect(speedSegmentsFromTraceAttributes(undefined)).toEqual([]);
    expect(speedSegmentsFromTraceAttributes({})).toEqual([]);
    expect(speedSegmentsFromTraceAttributes({ edges: 'nein' })).toEqual([]);
    expect(speedSegmentsFromTraceAttributes({ edges: [null, 5, 'x'] } as never)).toEqual([]);
  });
});

describe('buildTraceAttributesBody', () => {
  it('reicht die Geometrie unveraendert als kodierte Linie durch', () => {
    const body = buildTraceAttributesBody('abc123', 'truck');
    expect(body.encoded_polyline).toBe('abc123');
    expect(body.costing).toBe('truck');
  });

  /** `edge_walk` laeuft die vorhandene Geometrie ab. `map_snap` wuerde neu
   *  zuordnen und koennte die Route veraendern -- angezeigt werden muss aber
   *  die Route, die berechnet wurde. */
  it('laeuft die vorhandene Route ab, statt neu zuzuordnen', () => {
    expect(buildTraceAttributesBody('x', 'truck').shape_match).toBe('edge_walk');
  });

  /** Ohne `units: kilometers` skalierte Valhalla auf Meilen -- das Schild
   *  zeigte dann eine Zahl in der falschen Einheit, ohne dass es auffiele. */
  it('fordert km/h an', () => {
    expect(buildTraceAttributesBody('x', 'truck').units).toBe('kilometers');
  });

  it('holt nur die drei Felder, die gebraucht werden', () => {
    const filters = buildTraceAttributesBody('x', 'truck').filters as {
      attributes: string[];
      action: string;
    };
    expect(filters.action).toBe('include');
    expect(filters.attributes).toContain('edge.speed_limit');
    expect(filters.attributes).toContain('edge.begin_shape_index');
    expect(filters.attributes).toContain('edge.end_shape_index');
  });
});
