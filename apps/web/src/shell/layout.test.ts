/**
 * Unit tests for the slot-layout engine's pure logic (E07-T1 Pflicht-Tests):
 * widget->slot assignment (resolveSlotWidgets), the unknown-widget-id
 * robustness, and the local/server persistence merge (newest timestamp
 * wins).
 */

import { describe, it, expect } from 'vitest';
import { WidgetRegistry } from '@yapaja/ui';
import type { Widget } from '@yapaja/ui';
import {
  defaultLayout,
  mergeLayouts,
  mergeModeLayout,
  resolveSlotWidgets,
  type ModeLayout,
  type WidgetInstance,
} from './layout.js';

function makeWidget(id: string): Widget {
  return { id, name: id, sizes: ['S', 'M', 'L'], topics: [], render: () => null };
}

function buildRegistry(ids: string[]): WidgetRegistry {
  const registry = new WidgetRegistry();
  for (const id of ids) registry.register(makeWidget(id));
  return registry;
}

describe('resolveSlotWidgets (widget -> slot assignment)', () => {
  it('resolves every instance whose widgetId is registered, preserving order', () => {
    const registry = buildRegistry(['speed', 'eta', 'altitude']);
    const instances: WidgetInstance[] = [
      { instanceId: 'i1', widgetId: 'speed', size: 'L' },
      { instanceId: 'i2', widgetId: 'eta', size: 'M' },
      { instanceId: 'i3', widgetId: 'altitude', size: 'S' },
    ];
    const resolved = resolveSlotWidgets(instances, registry);
    expect(resolved.map((r) => r.widget.id)).toEqual(['speed', 'eta', 'altitude']);
    expect(resolved.map((r) => r.instance.instanceId)).toEqual(['i1', 'i2', 'i3']);
  });

  it('carries the instance size through untouched', () => {
    const registry = buildRegistry(['speed']);
    const instances: WidgetInstance[] = [{ instanceId: 'i1', widgetId: 'speed', size: 'L' }];
    const [resolved] = resolveSlotWidgets(instances, registry);
    expect(resolved.instance.size).toBe('L');
  });

  it('returns an empty array for an empty slot', () => {
    const registry = buildRegistry(['speed']);
    expect(resolveSlotWidgets([], registry)).toEqual([]);
  });

  describe('unknown widget id robustness (E07-T1 acceptance #4)', () => {
    it('silently skips an instance whose widgetId is not registered (uninstalled add-on)', () => {
      const registry = buildRegistry(['speed']);
      const instances: WidgetInstance[] = [
        { instanceId: 'i1', widgetId: 'speed', size: 'L' },
        { instanceId: 'i2', widgetId: 'com.example.uninstalled-addon/traffic-status', size: 'M' },
      ];
      const resolved = resolveSlotWidgets(instances, registry);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].widget.id).toBe('speed');
    });

    it('never throws even when EVERY instance is unknown', () => {
      const registry = buildRegistry([]);
      const instances: WidgetInstance[] = [{ instanceId: 'i1', widgetId: 'ghost', size: 'S' }];
      expect(() => resolveSlotWidgets(instances, registry)).not.toThrow();
      expect(resolveSlotWidgets(instances, registry)).toEqual([]);
    });
  });
});

describe('default layouts (docs/06 Section 1)', () => {
  it('drive mode matches the sketch: speed/eta/distance/altitude in bottom-bar, maneuver panel + speed-limit as map overlays', () => {
    const drive = defaultLayout('drive');
    expect(drive.slots['bottom-bar'].map((w) => w.widgetId)).toEqual(['speed', 'eta', 'distance', 'altitude']);
    expect(drive.slots['map-overlay-tl'].map((w) => w.widgetId)).toEqual(['next-instruction']);
    expect(drive.slots['map-overlay-tr'].map((w) => w.widgetId)).toEqual(['speed-limit']);
    // Sketch shows nothing else placed by default.
    expect(drive.slots['top-bar']).toEqual([]);
    expect(drive.slots['side-panel']).toEqual([]);
  });

  it('explore mode is empty across every slot (sketch shows only pre-existing, non-widget UI)', () => {
    const explore = defaultLayout('explore');
    for (const widgets of Object.values(explore.slots)) {
      expect(widgets).toEqual([]);
    }
  });
});

describe('mergeModeLayout (persistence merge: newest timestamp wins)', () => {
  const older: ModeLayout = { mode: 'explore', slots: defaultLayout('explore').slots, updatedAt: 1000 };
  const newer: ModeLayout = {
    mode: 'explore',
    slots: { ...defaultLayout('explore').slots, 'top-bar': [{ instanceId: 'x', widgetId: 'clock', size: 'S' }] },
    updatedAt: 2000,
  };

  it('picks server when server is newer', () => {
    expect(mergeModeLayout(older, newer)).toBe(newer);
  });

  it('picks local when local is newer', () => {
    expect(mergeModeLayout(newer, older)).toBe(newer);
  });

  it('falls back to server when local is null', () => {
    expect(mergeModeLayout(null, newer)).toBe(newer);
  });

  it('falls back to local when server is null', () => {
    expect(mergeModeLayout(newer, null)).toBe(newer);
  });

  it('returns null when both are null', () => {
    expect(mergeModeLayout(null, null)).toBeNull();
  });

  it('keeps local on an exact timestamp tie (deterministic tie-break)', () => {
    const tiedServer: ModeLayout = { ...older, updatedAt: older.updatedAt };
    expect(mergeModeLayout(older, tiedServer)).toBe(older);
  });
});

describe('mergeLayouts (both modes)', () => {
  it('merges each mode independently by its own newest timestamp', () => {
    const local = {
      explore: { mode: 'explore' as const, slots: defaultLayout('explore').slots, updatedAt: 5000 },
      drive: { mode: 'drive' as const, slots: defaultLayout('drive').slots, updatedAt: 100 },
    };
    const server = {
      explore: { mode: 'explore' as const, slots: defaultLayout('explore').slots, updatedAt: 100 },
      drive: { mode: 'drive' as const, slots: defaultLayout('drive').slots, updatedAt: 5000 },
    };
    const merged = mergeLayouts(local, server);
    expect(merged.explore.updatedAt).toBe(5000); // local won explore
    expect(merged.drive.updatedAt).toBe(5000); // server won drive
  });

  it('falls back to built-in defaults when a mode is present in neither source', () => {
    const merged = mergeLayouts(null, null);
    expect(merged.explore).toEqual(defaultLayout('explore'));
    expect(merged.drive).toEqual(defaultLayout('drive'));
  });

  it('a second device with no local cache picks up the server layout wholesale', () => {
    const server = {
      explore: {
        mode: 'explore' as const,
        slots: { ...defaultLayout('explore').slots, 'top-bar': [{ instanceId: 'x', widgetId: 'clock', size: 'S' as const }] },
        updatedAt: 9999,
      },
    };
    const merged = mergeLayouts(null, server);
    expect(merged.explore.slots['top-bar']).toEqual([{ instanceId: 'x', widgetId: 'clock', size: 'S' }]);
  });
});
