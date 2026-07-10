/**
 * Unit tests for live style switching (E01-T4): the "preserve custom
 * sources/layers + camera across setStyle" pattern in `styleSwitch.ts`.
 *
 * MapLibre itself is never rendered here (no WebGL in Node) — see
 * `mapStore.test.ts` for the precedent of testing against a mocked `Map`.
 * The mock's `setStyle` invokes the `transformStyle` callback synchronously
 * against a caller-supplied "previous live style", mirroring MapLibre's
 * real (synchronous, in-call) invocation — this matters because
 * `applyStyle` updates the tracked core-style ids (`trackCoreStyle`) right
 * *after* calling `map.setStyle`, so the merge must see the *old* tracked
 * ids, not the new ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { applyStyle, trackCoreStyle, resetCoreStyleTracking } from './styleSwitch';

interface MockMapOptions {
  center?: { lng: number; lat: number };
  zoom?: number;
  bearing?: number;
  pitch?: number;
  /** The style MapLibre would report as "currently live" (core layers/sources
   *  plus anything custom) at the moment `setStyle` is called. */
  previousLiveStyle?: StyleSpecification;
}

function createMockMap(opts: MockMapOptions = {}): {
  map: MapLibreMap;
  setStyleMock: ReturnType<typeof vi.fn>;
  jumpToMock: ReturnType<typeof vi.fn>;
  getMergedStyle: () => StyleSpecification | undefined;
} {
  let mergedStyle: StyleSpecification | undefined;
  const jumpToMock = vi.fn();
  const setStyleMock = vi.fn(
    (style: StyleSpecification, options: { transformStyle?: (p: unknown, n: unknown) => StyleSpecification }) => {
      mergedStyle = options.transformStyle
        ? options.transformStyle(opts.previousLiveStyle, style)
        : style;
    },
  );
  const map = {
    getCenter: vi.fn(() => opts.center ?? { lng: 7.5, lat: 51.0 }),
    getZoom: vi.fn(() => opts.zoom ?? 10),
    getBearing: vi.fn(() => opts.bearing ?? 0),
    getPitch: vi.fn(() => opts.pitch ?? 0),
    jumpTo: jumpToMock,
    setStyle: setStyleMock,
  } as unknown as MapLibreMap;
  return { map, setStyleMock, jumpToMock, getMergedStyle: () => mergedStyle };
}

const CORE_STYLE: Pick<StyleSpecification, 'layers' | 'sources'> = {
  sources: { 'yapaja-region': { type: 'vector', url: 'pmtiles://./tiles/germany.pmtiles' } },
  layers: [
    { id: 'background', type: 'background', paint: {} },
    { id: 'region-transportation', type: 'line', source: 'yapaja-region', 'source-layer': 'transportation' },
  ],
} as unknown as Pick<StyleSpecification, 'layers' | 'sources'>;

describe('styleSwitch', () => {
  beforeEach(() => {
    resetCoreStyleTracking();
  });

  it('applyStyle calls map.setStyle with the given style and a transformStyle option', () => {
    const { map, setStyleMock } = createMockMap();
    const nextStyle = { version: 8, sources: {}, layers: [] } as unknown as StyleSpecification;

    applyStyle(map, nextStyle);

    expect(setStyleMock).toHaveBeenCalledTimes(1);
    expect(setStyleMock.mock.calls[0][0]).toBe(nextStyle);
    expect(typeof setStyleMock.mock.calls[0][1].transformStyle).toBe('function');
  });

  it('applyStyle preserves the camera (center/zoom/bearing/pitch) via jumpTo', () => {
    const { map, jumpToMock } = createMockMap({ center: { lng: 8.4, lat: 49.0 }, zoom: 13, bearing: 45, pitch: 55 });
    const nextStyle = { version: 8, sources: {}, layers: [] } as unknown as StyleSpecification;

    applyStyle(map, nextStyle);

    expect(jumpToMock).toHaveBeenCalledWith({
      center: { lng: 8.4, lat: 49.0 },
      zoom: 13,
      bearing: 45,
      pitch: 55,
    });
  });

  it('merges custom layers/sources (not part of the tracked core style) into the next style', () => {
    trackCoreStyle(CORE_STYLE);

    const previousLiveStyle = {
      version: 8,
      sources: {
        ...CORE_STYLE.sources,
        'position-puck-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        ...CORE_STYLE.layers,
        { id: 'position-puck-layer', type: 'circle', source: 'position-puck-source' },
      ],
    } as unknown as StyleSpecification;

    const nextStyle = {
      version: 8,
      sources: { 'yapaja-region': { type: 'vector', url: 'pmtiles://./tiles/france.pmtiles' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000' } }],
    } as unknown as StyleSpecification;

    const { map, getMergedStyle } = createMockMap({ previousLiveStyle });
    applyStyle(map, nextStyle);
    const merged = getMergedStyle();

    expect(merged?.layers.map((l) => l.id)).toEqual(['background', 'position-puck-layer']);
    expect(Object.keys(merged?.sources ?? {})).toContain('position-puck-source');
    expect(Object.keys(merged?.sources ?? {})).toContain('yapaja-region');
    // The next style's own (rewritten) source URL wins, not the old one.
    expect((merged?.sources['yapaja-region'] as { url: string }).url).toBe('pmtiles://./tiles/france.pmtiles');
  });

  it('returns the next style unchanged when there is no previous live style', () => {
    trackCoreStyle(CORE_STYLE);
    const nextStyle = { version: 8, sources: {}, layers: [] } as unknown as StyleSpecification;
    const { map, getMergedStyle } = createMockMap({ previousLiveStyle: undefined });

    applyStyle(map, nextStyle);

    expect(getMergedStyle()).toBe(nextStyle);
  });

  it('does not duplicate layers/sources that are part of the tracked core style (no extra custom copy)', () => {
    trackCoreStyle(CORE_STYLE);
    const nextStyle = {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: {} }],
    } as unknown as StyleSpecification;
    // Live style has ONLY the tracked core layers/sources — nothing custom
    // was ever added on top.
    const previousLiveStyle = { version: 8, sources: CORE_STYLE.sources, layers: CORE_STYLE.layers } as unknown as StyleSpecification;

    const { map, getMergedStyle } = createMockMap({ previousLiveStyle });
    applyStyle(map, nextStyle);
    const merged = getMergedStyle();

    // Neither 'background' nor 'region-transportation' should be re-appended
    // as "custom" — the former would duplicate the next style's own layer.
    expect(merged?.layers.map((l) => l.id)).toEqual(['background']);
  });

  it('applyStyle updates tracking so the NEXT switch correctly diffs against the just-applied style', () => {
    trackCoreStyle(CORE_STYLE);

    // First switch: light -> dark (a different core style, e.g. renamed ids).
    const darkStyle = {
      version: 8,
      sources: { 'yapaja-region': { type: 'vector', url: 'pmtiles://./tiles/germany.pmtiles' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#111417' } }],
    } as unknown as StyleSpecification;
    const { map: map1 } = createMockMap({ previousLiveStyle: { ...CORE_STYLE, version: 8 } as unknown as StyleSpecification });
    applyStyle(map1, darkStyle);

    // Second switch: dark -> contrast. The "live" style at this point is
    // exactly `darkStyle` plus a dummy custom layer added meanwhile.
    const contrastStyle = {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#FFFFFF' } }],
    } as unknown as StyleSpecification;
    const previousLiveStyle = {
      ...darkStyle,
      layers: [...darkStyle.layers, { id: 'dummy-custom', type: 'circle', source: 'dummy-src' }],
      sources: { ...darkStyle.sources, 'dummy-src': { type: 'geojson', data: {} } },
    } as unknown as StyleSpecification;
    const { map: map2, getMergedStyle } = createMockMap({ previousLiveStyle });
    applyStyle(map2, contrastStyle);
    const merged = getMergedStyle();

    // darkStyle's own 'background' must not be duplicated; the dummy custom
    // layer added on top of it must survive into the contrast style.
    expect(merged?.layers.map((l) => l.id)).toEqual(['background', 'dummy-custom']);
  });
});
