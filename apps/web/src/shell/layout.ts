/**
 * Slot-layout data model + pure logic (E07-T1).
 *
 * A `ModeLayout` is what gets persisted (localStorage + server `settings`
 * key `layouts`, see `persistence.ts`): the ordered widget instances per
 * slot for ONE shell mode, plus an `updatedAt` timestamp that's the merge
 * key for "newest wins" reconciliation between a device's local cache and
 * the server (docs E07-T1 acceptance criterion 3).
 *
 * Every function here is pure (no DOM, no fetch, no localStorage) so it's
 * trivially unit-testable -- see `layout.test.ts`.
 */

import type { ShellMode, SlotId, Widget, WidgetSize } from '@yapaja/ui';
import { SLOT_IDS } from '@yapaja/ui';
import type { WidgetRegistry } from '@yapaja/ui';

export type { SlotId, ShellMode };

/** One placed widget within a slot. `instanceId` is independent of the
 *  widget catalogue `widgetId` -- the SAME widget could appear twice (or in
 *  two different slots) without colliding, which the future drag-and-drop
 *  editor (E07-T2) needs. */
export interface WidgetInstance {
  instanceId: string;
  widgetId: string;
  size: WidgetSize;
}

export type SlotLayout = Record<SlotId, WidgetInstance[]>;

/** A full, persistable layout for one shell mode. */
export interface ModeLayout {
  mode: ShellMode;
  slots: SlotLayout;
  /** `Date.now()` of the last local edit -- the merge key (newest wins). */
  updatedAt: number;
}

/** The `layouts` settings-key value shape: one `ModeLayout` per mode. */
export interface LayoutsSettingsValue {
  explore: ModeLayout;
  drive: ModeLayout;
}

function emptySlots(): SlotLayout {
  const slots = {} as SlotLayout;
  for (const slot of SLOT_IDS) {
    slots[slot] = [];
  }
  return slots;
}

/**
 * Default layouts (E07-T1 acceptance criterion 1: "Default-Layouts
 * entsprechen den Skizzen docs/06 Section 1").
 *
 * Drive mode mirrors the docs/06 Section 1 sketch exactly: the maneuver
 * panel top-left overlay, the speed-limit sign top-right overlay, and the
 * bottom-bar strip "87 km/h | ETA 17:42 | 213 km | (altitude)".
 *
 * Explore mode's sketch shows only PRE-EXISTING, non-widget UI in every
 * slot-adjacent area (hamburger/search/profile in the top-bar, map zoom/
 * follow/2D-3D controls, the favorites bottom-drawer) -- none of this
 * task's core widgets (speed/altitude/clock/compass/...) appear in that
 * sketch at all. Rather than invent a placement the sketch doesn't show,
 * explore's default is intentionally EMPTY across every slot; a user adds
 * any registered widget via the widget library (E07-T2).
 */
export function defaultLayout(mode: ShellMode): ModeLayout {
  if (mode === 'explore') {
    return { mode, slots: emptySlots(), updatedAt: 0 };
  }

  const slots = emptySlots();
  slots['bottom-bar'] = [
    { instanceId: 'default-drive-speed', widgetId: 'speed', size: 'L' },
    { instanceId: 'default-drive-eta', widgetId: 'eta', size: 'M' },
    { instanceId: 'default-drive-distance', widgetId: 'distance', size: 'M' },
    { instanceId: 'default-drive-altitude', widgetId: 'altitude', size: 'S' },
  ];
  slots['map-overlay-tl'] = [{ instanceId: 'default-drive-next-instruction', widgetId: 'next-instruction', size: 'L' }];
  slots['map-overlay-tr'] = [{ instanceId: 'default-drive-speed-limit', widgetId: 'speed-limit', size: 'S' }];
  return { mode, slots, updatedAt: 0 };
}

export function defaultLayoutsSettingsValue(): LayoutsSettingsValue {
  return { explore: defaultLayout('explore'), drive: defaultLayout('drive') };
}

/** One resolved (instance + its widget definition) entry -- see `resolveSlotWidgets`. */
export interface ResolvedWidget {
  instance: WidgetInstance;
  widget: Widget;
}

/**
 * Resolves a slot's widget instances against a registry, SILENTLY skipping
 * any instance whose `widgetId` isn't registered (E07-T1 acceptance
 * criterion 4: an uninstalled add-on's widget id in a stored layout must
 * never crash the shell -- it's simply omitted from what renders).
 */
export function resolveSlotWidgets(instances: WidgetInstance[], registry: WidgetRegistry): ResolvedWidget[] {
  const resolved: ResolvedWidget[] = [];
  for (const instance of instances) {
    const widget = registry.get(instance.widgetId);
    if (widget) {
      resolved.push({ instance, widget });
    }
  }
  return resolved;
}

/**
 * Merge rule for ONE mode's layout: "neuester Zeitstempel gewinnt" (newest
 * timestamp wins, E07-T1 Pflicht-Test). `null` on either side means "not
 * present" (e.g. no local cache yet, or the server has never seen this
 * mode) -- the other side wins outright. Equal timestamps keep `local`
 * (arbitrary but deterministic tie-break; in practice `local` and `server`
 * are then byte-identical anyway, since a save always writes both together).
 */
export function mergeModeLayout(local: ModeLayout | null, server: ModeLayout | null): ModeLayout | null {
  if (!local) return server;
  if (!server) return local;
  return server.updatedAt > local.updatedAt ? server : local;
}

/** Merges both modes' layouts (see `mergeModeLayout`). Falls back to the
 *  built-in defaults for any mode missing from BOTH sources. */
export function mergeLayouts(
  local: Partial<LayoutsSettingsValue> | null,
  server: Partial<LayoutsSettingsValue> | null,
): LayoutsSettingsValue {
  const explore = mergeModeLayout(local?.explore ?? null, server?.explore ?? null) ?? defaultLayout('explore');
  const drive = mergeModeLayout(local?.drive ?? null, server?.drive ?? null) ?? defaultLayout('drive');
  return { explore, drive };
}
