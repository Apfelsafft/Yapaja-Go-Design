/**
 * Unit tests for the edit-mode pure logic (E07-T2 mandatory Vitest
 * coverage): slot-compatibility ("can widgetId at size X go into slot Y")
 * and the layout diff/apply operations (move/add/remove/cycle-size), plus
 * the standstill gate.
 */

import { describe, it, expect } from 'vitest';
import { WidgetRegistry } from '@yapaja/ui';
import type { Widget, WidgetSize } from '@yapaja/ui';
import type { SlotLayout, WidgetInstance } from '../layout.js';
import { SLOT_IDS } from '@yapaja/ui';
import {
  SLOT_SIZE_POLICY,
  slotAcceptsSize,
  widgetSupportsSize,
  canPlaceInSlot,
  moveWidgetInstance,
  addWidgetInstance,
  removeWidgetInstance,
  cycleWidgetInstanceSize,
  slotLayoutsEqual,
  diffSlotLayouts,
  isStandstill,
  STANDSTILL_SPEED_THRESHOLD_MS,
  canDropIntoSlot,
} from './editModel.js';

function makeWidget(id: string, sizes: WidgetSize[]): Widget {
  return { id, name: id, sizes, topics: [], render: () => null };
}

function emptySlots(): SlotLayout {
  const slots = {} as SlotLayout;
  for (const slot of SLOT_IDS) slots[slot] = [];
  return slots;
}

function buildRegistry(widgets: Widget[]): WidgetRegistry {
  const registry = new WidgetRegistry();
  for (const w of widgets) registry.register(w);
  return registry;
}

describe('SLOT_SIZE_POLICY / slotAcceptsSize', () => {
  it('top-bar and map-overlay-tr accept only S and M', () => {
    expect(SLOT_SIZE_POLICY['top-bar']).toEqual(['S', 'M']);
    expect(SLOT_SIZE_POLICY['map-overlay-tr']).toEqual(['S', 'M']);
    expect(slotAcceptsSize('top-bar', 'L')).toBe(false);
    expect(slotAcceptsSize('map-overlay-tr', 'L')).toBe(false);
    expect(slotAcceptsSize('top-bar', 'S')).toBe(true);
    expect(slotAcceptsSize('top-bar', 'M')).toBe(true);
  });

  it('every other slot accepts S, M, and L', () => {
    const fullSlots = SLOT_IDS.filter((s) => s !== 'top-bar' && s !== 'map-overlay-tr');
    for (const slot of fullSlots) {
      expect(slotAcceptsSize(slot, 'S')).toBe(true);
      expect(slotAcceptsSize(slot, 'M')).toBe(true);
      expect(slotAcceptsSize(slot, 'L')).toBe(true);
    }
  });
});

describe('widgetSupportsSize / canPlaceInSlot (plausibility)', () => {
  it('an L-only widget can never go into a slot capped at S/M', () => {
    const lOnly = makeWidget('big-widget', ['L']);
    expect(widgetSupportsSize(lOnly, 'L')).toBe(true);
    expect(canPlaceInSlot(lOnly, 'L', 'top-bar')).toBe(false);
    expect(canPlaceInSlot(lOnly, 'L', 'map-overlay-tr')).toBe(false);
    // ...but fits fine in an unrestricted slot.
    expect(canPlaceInSlot(lOnly, 'L', 'bottom-bar')).toBe(true);
  });

  it('rejects a size the widget itself never declared, even if the slot would allow it', () => {
    const smallOnly = makeWidget('small-widget', ['S']);
    expect(canPlaceInSlot(smallOnly, 'L', 'bottom-bar')).toBe(false);
    expect(canPlaceInSlot(smallOnly, 'M', 'bottom-bar')).toBe(false);
    expect(canPlaceInSlot(smallOnly, 'S', 'bottom-bar')).toBe(true);
  });

  it('a fully flexible S/M/L widget fits every slot at every size the slot allows', () => {
    const flexible = makeWidget('flexible', ['S', 'M', 'L']);
    for (const slot of SLOT_IDS) {
      for (const size of SLOT_SIZE_POLICY[slot]) {
        expect(canPlaceInSlot(flexible, size, slot)).toBe(true);
      }
    }
    expect(canPlaceInSlot(flexible, 'L', 'top-bar')).toBe(false);
  });
});

describe('moveWidgetInstance', () => {
  it('moves a compatible instance into a new slot', () => {
    const widget = makeWidget('clock', ['S', 'M', 'L']);
    const registry = buildRegistry([widget]);
    const slots = emptySlots();
    slots['top-bar'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'S' }];

    const result = moveWidgetInstance(slots, registry, 'i1', 'bottom-bar');
    expect(result.ok).toBe(true);
    expect(result.slots['top-bar']).toEqual([]);
    expect(result.slots['bottom-bar']).toEqual([{ instanceId: 'i1', widgetId: 'clock', size: 'S' }]);
  });

  it('REFUSES to move an L-sized instance into a slot that cannot hold L, leaving the draft unchanged', () => {
    const widget = makeWidget('big-widget', ['S', 'M', 'L']);
    const registry = buildRegistry([widget]);
    const slots = emptySlots();
    slots['bottom-bar'] = [{ instanceId: 'i1', widgetId: 'big-widget', size: 'L' }];

    const result = moveWidgetInstance(slots, registry, 'i1', 'top-bar');
    expect(result.ok).toBe(false);
    // The instance stays exactly where it was.
    expect(result.slots['bottom-bar']).toEqual([{ instanceId: 'i1', widgetId: 'big-widget', size: 'L' }]);
    expect(result.slots['top-bar']).toEqual([]);
  });

  it('refuses when the instance id does not exist', () => {
    const registry = buildRegistry([makeWidget('clock', ['S'])]);
    const slots = emptySlots();
    const result = moveWidgetInstance(slots, registry, 'ghost', 'bottom-bar');
    expect(result.ok).toBe(false);
    expect(result.slots).toBe(slots);
  });

  it('refuses when the widget is no longer registered', () => {
    const registry = buildRegistry([]); // empty -- simulates an uninstalled add-on
    const slots = emptySlots();
    slots['top-bar'] = [{ instanceId: 'i1', widgetId: 'gone', size: 'S' }];
    const result = moveWidgetInstance(slots, registry, 'i1', 'bottom-bar');
    expect(result.ok).toBe(false);
  });
});

describe('addWidgetInstance (drag from the Widget Library)', () => {
  it('adds a new instance at the preferred size when it fits', () => {
    const widget = makeWidget('eta', ['S', 'M', 'L']);
    const slots = emptySlots();
    const result = addWidgetInstance(slots, widget, 'bottom-bar', 'new-1', 'M');
    expect(result.ok).toBe(true);
    expect(result.slots['bottom-bar']).toEqual([{ instanceId: 'new-1', widgetId: 'eta', size: 'M' }]);
  });

  it('falls back to the first size the slot accepts when the preferred size does not fit', () => {
    const widget = makeWidget('eta', ['M', 'L']);
    const slots = emptySlots();
    // top-bar only accepts S/M -- preferred L is rejected, falls back to M.
    const result = addWidgetInstance(slots, widget, 'top-bar', 'new-1', 'L');
    expect(result.ok).toBe(true);
    expect(result.slots['top-bar']).toEqual([{ instanceId: 'new-1', widgetId: 'eta', size: 'M' }]);
  });

  it('refuses when NO size of the widget fits the target slot at all', () => {
    const lOnly = makeWidget('big-widget', ['L']);
    const slots = emptySlots();
    const result = addWidgetInstance(slots, lOnly, 'top-bar', 'new-1');
    expect(result.ok).toBe(false);
    expect(result.slots).toBe(slots);
  });
});

describe('removeWidgetInstance (drag onto the trash zone)', () => {
  it('removes the instance from its slot', () => {
    const slots = emptySlots();
    slots['side-panel'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'S' }];
    const result = removeWidgetInstance(slots, 'i1');
    expect(result.ok).toBe(true);
    expect(result.slots['side-panel']).toEqual([]);
  });

  it('is a no-op for an unknown instance id', () => {
    const slots = emptySlots();
    const result = removeWidgetInstance(slots, 'ghost');
    expect(result.ok).toBe(false);
    expect(result.slots).toBe(slots);
  });
});

describe('cycleWidgetInstanceSize (tap on the size badge)', () => {
  it('cycles S -> M -> L -> S for a fully flexible widget in an unrestricted slot', () => {
    const widget = makeWidget('flexible', ['S', 'M', 'L']);
    const registry = buildRegistry([widget]);
    let slots = emptySlots();
    slots['bottom-bar'] = [{ instanceId: 'i1', widgetId: 'flexible', size: 'S' }];

    let result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.ok).toBe(true);
    expect(result.slots['bottom-bar'][0].size).toBe('M');
    slots = result.slots;

    result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.slots['bottom-bar'][0].size).toBe('L');
    slots = result.slots;

    result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.slots['bottom-bar'][0].size).toBe('S');
  });

  it('skips a size the SLOT rejects even though the widget supports it', () => {
    // top-bar caps at M -- an S/M/L widget placed there cycles S -> M -> S,
    // never landing on L.
    const widget = makeWidget('flexible', ['S', 'M', 'L']);
    const registry = buildRegistry([widget]);
    let slots = emptySlots();
    slots['top-bar'] = [{ instanceId: 'i1', widgetId: 'flexible', size: 'S' }];

    let result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.slots['top-bar'][0].size).toBe('M');
    slots = result.slots;

    result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.slots['top-bar'][0].size).toBe('S'); // wraps, skipping L
  });

  it('skips a size the WIDGET itself does not support', () => {
    // Widget supports only S and L (no M) -- cycling from S should land on
    // L directly, skipping M.
    const widget = makeWidget('s-and-l', ['S', 'L']);
    const registry = buildRegistry([widget]);
    const slots = emptySlots();
    slots['bottom-bar'] = [{ instanceId: 'i1', widgetId: 's-and-l', size: 'S' }];

    const result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.ok).toBe(true);
    expect(result.slots['bottom-bar'][0].size).toBe('L');
  });

  it('is a no-op when no other valid size exists for this widget/slot combination', () => {
    const widget = makeWidget('s-only', ['S']);
    const registry = buildRegistry([widget]);
    const slots = emptySlots();
    slots['top-bar'] = [{ instanceId: 'i1', widgetId: 's-only', size: 'S' }];

    const result = cycleWidgetInstanceSize(slots, registry, 'i1');
    expect(result.ok).toBe(false);
    expect(result.slots['top-bar'][0].size).toBe('S');
  });
});

describe('slotLayoutsEqual / diffSlotLayouts', () => {
  it('reports no diff for two structurally identical layouts', () => {
    const a = emptySlots();
    a['top-bar'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'S' }];
    const b = emptySlots();
    b['top-bar'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'S' }];

    expect(slotLayoutsEqual(a, b)).toBe(true);
    expect(diffSlotLayouts(a, b)).toEqual([]);
  });

  it('reports the exact slot(s) that differ by size, by presence, or by order', () => {
    const a = emptySlots();
    a['top-bar'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'S' }];
    a['bottom-bar'] = [{ instanceId: 'i2', widgetId: 'eta', size: 'M' }];

    const b = emptySlots();
    b['top-bar'] = [{ instanceId: 'i1', widgetId: 'clock', size: 'M' }]; // size differs
    b['bottom-bar'] = [{ instanceId: 'i2', widgetId: 'eta', size: 'M' }]; // identical

    expect(slotLayoutsEqual(a, b)).toBe(false);
    expect(diffSlotLayouts(a, b)).toEqual(['top-bar']);
  });

  it('detects an added/removed instance', () => {
    const a = emptySlots();
    const b = emptySlots();
    b['side-panel'] = [{ instanceId: 'new', widgetId: 'clock', size: 'S' } satisfies WidgetInstance];
    expect(diffSlotLayouts(a, b)).toEqual(['side-panel']);
  });
});

describe('canDropIntoSlot (drop-target hover validity)', () => {
  it('an instance drag is valid only if its fixed size fits the slot', () => {
    const lOnly = makeWidget('big-widget', ['L']);
    expect(canDropIntoSlot({ kind: 'instance', widget: lOnly, size: 'L' }, 'top-bar')).toBe(false);
    expect(canDropIntoSlot({ kind: 'instance', widget: lOnly, size: 'L' }, 'bottom-bar')).toBe(true);
  });

  it('a library drag is valid if ANY of the widget sizes would fit', () => {
    const flexible = makeWidget('flexible', ['S', 'M', 'L']);
    // top-bar rejects L but the widget also supports S/M -- still a valid drop.
    expect(canDropIntoSlot({ kind: 'library', widget: flexible, size: 'S' }, 'top-bar')).toBe(true);
  });

  it('a library drag is invalid when NONE of the widget sizes fit the slot', () => {
    const lOnly = makeWidget('big-widget', ['L']);
    expect(canDropIntoSlot({ kind: 'library', widget: lOnly, size: 'L' }, 'top-bar')).toBe(false);
    expect(canDropIntoSlot({ kind: 'library', widget: lOnly, size: 'L' }, 'map-overlay-tr')).toBe(false);
  });
});

describe('isStandstill (edit-mode entry gate, 5 km/h threshold)', () => {
  it('treats unknown speed (no pos/update yet) as standstill', () => {
    expect(isStandstill(undefined)).toBe(true);
    expect(isStandstill(null)).toBe(true);
  });

  it('allows entry strictly below the 5 km/h threshold', () => {
    expect(isStandstill(0)).toBe(true);
    expect(isStandstill(1)).toBe(true);
    expect(isStandstill(STANDSTILL_SPEED_THRESHOLD_MS - 0.01)).toBe(true);
  });

  it('refuses entry at or above the 5 km/h threshold', () => {
    expect(isStandstill(STANDSTILL_SPEED_THRESHOLD_MS)).toBe(false);
    expect(isStandstill(15)).toBe(false); // 54 km/h, the shell.spec.ts drive fixture
  });
});
