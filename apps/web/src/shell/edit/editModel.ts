/**
 * Edit-mode pure logic (E07-T2): slot size-capacity policy + plausibility
 * checking, draft layout diff/apply operations, and the standstill gate.
 *
 * Deliberately has ZERO DOM/React/store dependencies (mirrors `layout.ts`'s
 * own "pure logic" boundary) so every rule here -- especially the
 * plausibility check, which is this task's IMPORTANT acceptance criterion --
 * is trivially unit-testable without mounting anything.
 */

import type { SlotId, Widget, WidgetSize } from '@yapaja/ui';
import { SLOT_IDS } from '@yapaja/ui';
import type { WidgetRegistry } from '@yapaja/ui';
import type { SlotLayout, WidgetInstance } from '../layout.js';

/**
 * Per-slot size-capacity policy (task E07-T2 spec, verbatim):
 *  - `top-bar` and `map-overlay-tr` are small strips/overlays -- S and M only
 *    (an L widget would visually blow out a top bar or a corner overlay).
 *  - Every other slot (`bottom-bar`, `side-panel`, `bottom-drawer`,
 *    `map-overlay-tl`, `map-overlay-bl`, `map-overlay-br`, `settings`) has
 *    room for any size, S/M/L.
 *
 * This is intentionally a flat, explicit table (not a formula) -- a slot's
 * capacity is a UI-layout fact, not something derivable from its id string.
 */
export const SLOT_SIZE_POLICY: Readonly<Record<SlotId, readonly WidgetSize[]>> = {
  'top-bar': ['S', 'M'],
  'bottom-bar': ['S', 'M', 'L'],
  'side-panel': ['S', 'M', 'L'],
  'bottom-drawer': ['S', 'M', 'L'],
  'map-overlay-tl': ['S', 'M', 'L'],
  'map-overlay-tr': ['S', 'M'],
  'map-overlay-bl': ['S', 'M', 'L'],
  'map-overlay-br': ['S', 'M', 'L'],
  settings: ['S', 'M', 'L'],
};

/** Whether `slotId` accepts an instance at `size` at all (ignoring the widget). */
export function slotAcceptsSize(slotId: SlotId, size: WidgetSize): boolean {
  return SLOT_SIZE_POLICY[slotId].includes(size);
}

/** Whether `widget` itself supports being placed at `size` (its own `sizes` declaration). */
export function widgetSupportsSize(widget: Pick<Widget, 'sizes'>, size: WidgetSize): boolean {
  return widget.sizes.includes(size);
}

/**
 * THE plausibility check (task's IMPORTANT acceptance criterion): a widget
 * instance fits a slot iff BOTH the widget supports that size AND the slot
 * accepts that size. Neither condition alone is sufficient -- e.g. an
 * L-capable widget still can't go into `top-bar` (slot caps it at M), and a
 * widget that only declares `sizes: ['L']` can't go into `top-bar` even
 * though `top-bar` would happily accept an S/M instance of some OTHER widget.
 */
export function canPlaceInSlot(widget: Pick<Widget, 'sizes'>, size: WidgetSize, slotId: SlotId): boolean {
  return widgetSupportsSize(widget, size) && slotAcceptsSize(slotId, size);
}

/** Deep-enough clone of a `SlotLayout`: a fresh object + fresh arrays per slot
 *  (instances themselves are treated as immutable value objects and reused). */
export function cloneSlots(slots: SlotLayout): SlotLayout {
  const out = {} as SlotLayout;
  for (const slotId of SLOT_IDS) {
    out[slotId] = [...(slots[slotId] ?? [])];
  }
  return out;
}

interface FoundInstance {
  slotId: SlotId;
  index: number;
  instance: WidgetInstance;
}

function findInstance(slots: SlotLayout, instanceId: string): FoundInstance | undefined {
  for (const slotId of SLOT_IDS) {
    const list = slots[slotId] ?? [];
    const index = list.findIndex((i) => i.instanceId === instanceId);
    if (index !== -1) {
      return { slotId, index, instance: list[index] };
    }
  }
  return undefined;
}

/** Result of an apply operation: `ok: false` means the draft is returned
 *  UNCHANGED (same values, safe to ignore) -- callers use this to drive the
 *  "visibly refuse" plausibility UI without needing a try/catch. */
export interface ApplyResult {
  slots: SlotLayout;
  ok: boolean;
}

/**
 * Moves an already-placed instance to `toSlot` (append at the end, or at
 * `toIndex` if given). Refuses (returns the ORIGINAL `slots`, `ok: false`)
 * when: the instance isn't found, its widget isn't registered, or the
 * instance's size doesn't fit `toSlot` (the plausibility check).
 */
export function moveWidgetInstance(
  slots: SlotLayout,
  registry: WidgetRegistry,
  instanceId: string,
  toSlot: SlotId,
  toIndex?: number,
): ApplyResult {
  const found = findInstance(slots, instanceId);
  if (!found) return { slots, ok: false };

  const widget = registry.get(found.instance.widgetId);
  if (!widget) return { slots, ok: false };

  if (!canPlaceInSlot(widget, found.instance.size, toSlot)) {
    return { slots, ok: false };
  }

  const next = cloneSlots(slots);
  next[found.slotId] = next[found.slotId].filter((i) => i.instanceId !== instanceId);
  const targetList = found.slotId === toSlot ? next[toSlot] : next[toSlot];
  const insertIndex = toIndex == null ? targetList.length : Math.max(0, Math.min(toIndex, targetList.length));
  next[toSlot] = [...targetList.slice(0, insertIndex), found.instance, ...targetList.slice(insertIndex)];
  return { slots: next, ok: true };
}

/**
 * Adds a NEW instance of `widget` (e.g. dragged out of the Widget Library
 * drawer, which lists widgets that aren't necessarily placed anywhere yet)
 * into `toSlot`. `preferredSize` is used if it fits; otherwise the first of
 * the widget's own declared sizes that `toSlot` also accepts is picked.
 * Refuses (unchanged `slots`, `ok: false`) if no size fits at all.
 */
export function addWidgetInstance(
  slots: SlotLayout,
  widget: Widget,
  toSlot: SlotId,
  instanceId: string,
  preferredSize?: WidgetSize,
): ApplyResult {
  const size =
    preferredSize && canPlaceInSlot(widget, preferredSize, toSlot)
      ? preferredSize
      : widget.sizes.find((s) => canPlaceInSlot(widget, s, toSlot));
  if (!size) return { slots, ok: false };

  const next = cloneSlots(slots);
  next[toSlot] = [...next[toSlot], { instanceId, widgetId: widget.id, size }];
  return { slots: next, ok: true };
}

/** Removes an instance from wherever it is (e.g. dropped onto the trash zone). */
export function removeWidgetInstance(slots: SlotLayout, instanceId: string): ApplyResult {
  const found = findInstance(slots, instanceId);
  if (!found) return { slots, ok: false };

  const next = cloneSlots(slots);
  next[found.slotId] = next[found.slotId].filter((i) => i.instanceId !== instanceId);
  return { slots: next, ok: true };
}

/** S -> M -> L -> S. Used by `cycleWidgetInstanceSize` to walk sizes in order. */
const SIZE_CYCLE: readonly WidgetSize[] = ['S', 'M', 'L'];

/**
 * Cycles an instance to the NEXT size (tap on its size badge) that is valid
 * in its CURRENT slot -- sizes the widget itself doesn't support, or that
 * the slot doesn't accept, are skipped rather than offered. If no other
 * valid size exists (the widget/slot combination only ever fits one size),
 * this is a no-op (`ok: false`, unchanged `slots`).
 */
export function cycleWidgetInstanceSize(slots: SlotLayout, registry: WidgetRegistry, instanceId: string): ApplyResult {
  const found = findInstance(slots, instanceId);
  if (!found) return { slots, ok: false };

  const widget = registry.get(found.instance.widgetId);
  if (!widget) return { slots, ok: false };

  const currentIndex = SIZE_CYCLE.indexOf(found.instance.size);
  for (let step = 1; step <= SIZE_CYCLE.length; step++) {
    const candidate = SIZE_CYCLE[(currentIndex + step) % SIZE_CYCLE.length];
    if (candidate !== found.instance.size && canPlaceInSlot(widget, candidate, found.slotId)) {
      const next = cloneSlots(slots);
      next[found.slotId] = next[found.slotId].map((i) =>
        i.instanceId === instanceId ? { ...i, size: candidate } : i,
      );
      return { slots: next, ok: true };
    }
  }
  return { slots, ok: false };
}

/** Structural equality of two `SlotLayout`s (instance id + widget id + size,
 *  order-sensitive within each slot) -- the basis for "has the draft
 *  changed" (enabling Save) and "did Reset/Cancel actually restore the
 *  exact default/original" assertions. */
export function slotLayoutsEqual(a: SlotLayout, b: SlotLayout): boolean {
  return diffSlotLayouts(a, b).length === 0;
}

/** Returns the list of slot ids whose instance lists differ between `a` and
 *  `b` (id, widgetId, or size differs, or the list length differs). Empty
 *  array means the two layouts are structurally identical. */
export function diffSlotLayouts(a: SlotLayout, b: SlotLayout): SlotId[] {
  return SLOT_IDS.filter((slotId) => {
    const ai = a[slotId] ?? [];
    const bi = b[slotId] ?? [];
    if (ai.length !== bi.length) return true;
    return ai.some((inst, i) => {
      const other = bi[i];
      return inst.instanceId !== other.instanceId || inst.widgetId !== other.widgetId || inst.size !== other.size;
    });
  });
}

/**
 * The two kinds of drag source in the edit-mode `DndContext` (E07-T2):
 *  - `instance`: an already-placed widget being moved between slots (or onto
 *    the trash zone) -- carries its OWN fixed `size`.
 *  - `library`: a widget dragged out of the Widget Library drawer, which
 *    lists every REGISTERED widget (task requirement: "including ones not
 *    currently placed") -- has no size yet; `addWidgetInstance` picks one
 *    that fits the drop target.
 *
 * This is the `useDraggable({ data })` payload shape shared between
 * `Shell.tsx` (drag source setup + `onDragEnd` handling) and
 * `edit/WidgetLibraryDrawer.tsx` (library drag sources) -- kept here so both
 * import the SAME type rather than risking two independently-hand-written
 * shapes drifting apart.
 */
export type DragItemData =
  | { kind: 'instance'; instanceId: string; widgetId: string; size: WidgetSize }
  | { kind: 'library'; widgetId: string };

/** Minimal "what's being dragged right now" shape a Slot needs to decide its
 *  own hover-validity highlight -- see `canDropIntoSlot`. */
export interface ActiveDragKind {
  kind: 'instance' | 'library';
  widget: Pick<Widget, 'sizes'>;
  /** Only meaningful for `kind: 'instance'` (a library drag has no size yet). */
  size: WidgetSize;
}

/**
 * Whether the currently-dragged item COULD end up placed in `slotId` at all:
 *  - an `instance` drag has one fixed size -- straightforward `canPlaceInSlot`.
 *  - a `library` drag has no size yet -- valid if ANY of the widget's sizes
 *    would fit (mirrors `addWidgetInstance`'s own fallback-size selection, so
 *    the hover highlight never disagrees with what the actual drop does).
 */
export function canDropIntoSlot(drag: ActiveDragKind, slotId: SlotId): boolean {
  if (drag.kind === 'instance') return canPlaceInSlot(drag.widget, drag.size, slotId);
  return drag.widget.sizes.some((size) => canPlaceInSlot(drag.widget, size, slotId));
}

/**
 * Standstill gate (task acceptance criterion 2): edit mode may only be
 * ENTERED below 5 km/h (~1.389 m/s), read from the `pos/update` topic's
 * `speed` field (m/s, matching `apps/core`'s `Position` shape).
 *
 * `speedMs == null` (no `pos/update` message has arrived yet -- e.g. the app
 * just booted, no GPS fix received) is treated as standstill: refusing to
 * ever allow editing until SOME position fix has arrived would strand a
 * parked vehicle (or a desktop dev/test session with no simulator running)
 * with no way in. The only case this gate exists to block is a CONFIRMED
 * speed at or above the threshold.
 */
export const STANDSTILL_SPEED_THRESHOLD_MS = 5 / 3.6; // 5 km/h in m/s, ~1.3889

export function isStandstill(speedMs: number | null | undefined): boolean {
  if (speedMs == null || Number.isNaN(speedMs)) return true;
  return speedMs < STANDSTILL_SPEED_THRESHOLD_MS;
}
