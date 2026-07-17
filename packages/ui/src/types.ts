/**
 * The Widget contract (E07-T1, docs/06 Section 2 "Widget-System & Customizing").
 *
 * This is the STABLE interface both Core widgets (apps/web/src/shell/widgets)
 * and, later, add-on-registered widgets (docs/05 Section 4 -- "Add-on-Widgets
 * erscheinen automatisch in der Widget-Bibliothek ... Slots sind
 * Add-on-Schnittstelle") implement. Keep it deliberately small: a widget
 * declares WHAT it needs (topics) and WHERE it can go (sizes); it never
 * reaches into a WebSocket, a store, or the DOM directly -- the host (the
 * slot-layout engine, `apps/web/src/shell/`) is the only thing that owns the
 * WebSocket connection and hands the widget its data as plain props via
 * `render(ctx)`. That's what lets many widgets share exactly one `/ws/v1`
 * connection (see `apps/web/src/shell/wsStore.ts`).
 */

import type { ReactNode } from 'react';

/** The three sizes a widget instance can be placed at (docs/06 Section 2). */
export type WidgetSize = 'S' | 'M' | 'L';

/**
 * Slots the shell exposes (docs/05 Section 4, docs/06 Section 1/2). This is
 * literally the add-on interface: a Frontend-Add-on's manifest
 * (`yapaja-addon.json` -> `ui.widgets[].slots`) declares widgets against this
 * SAME vocabulary, so the Core never has to special-case add-on widgets vs.
 * its own.
 */
export const SLOT_IDS = [
  'top-bar',
  'bottom-bar',
  'side-panel',
  'bottom-drawer',
  'map-overlay-tl',
  'map-overlay-tr',
  'map-overlay-bl',
  'map-overlay-br',
  'settings',
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** The two layout modes a layout is persisted per (docs/06 Section 2). */
export type ShellMode = 'explore' | 'drive';

/**
 * What a widget's `render` function receives. Deliberately just plain data --
 * no store handles, no WebSocket, no DOM refs -- so a widget can be unit- or
 * snapshot-tested (and, later, run inside an add-on's sandboxed iframe) with
 * zero host coupling.
 */
export interface WidgetRenderContext<TSettings = unknown> {
  /** The size this widget INSTANCE currently occupies. */
  size: WidgetSize;
  /** The shell mode this instance is being rendered in. */
  mode: ShellMode;
  /**
   * Latest payload observed for each of the widget's declared `topics`,
   * keyed by the EXACT topic string the bus published under (e.g.
   * `"pos/update"`, `"nav/state"`) -- see `apps/core/src/bus/ws.ts`'s
   * `{topic, payload, ts}` message shape. A topic the widget declared but no
   * message has arrived for yet is simply absent from this record (never
   * `null`/`undefined` filler -- check with `topic in data` or optional
   * chaining).
   */
  data: Readonly<Record<string, unknown>>;
  /** Whether the shared `/ws/v1` connection is currently open. */
  connected: boolean;
  /** This widget instance's own persisted settings, if any (see `settings` below). */
  settings: TSettings | undefined;
}

/** Optional per-widget settings contract: a JSON-serializable default value.
 *  A real settings-editing UI is out of E07-T1's scope (later E07 task); this
 *  only defines the SHAPE so a widget can declare defaults today without a
 *  breaking change once that UI exists. */
export interface WidgetSettingsSchema<TSettings> {
  defaults: TSettings;
}

/** A widget definition, as registered with a `WidgetRegistry`. */
export interface Widget<TSettings = unknown> {
  /** Globally unique id, e.g. `"speed"`, `"com.example.traffic-warner/traffic-status"` for add-ons. */
  id: string;
  /** Human-readable name shown in the (future, E07-T2) widget library. */
  name: string;
  /** Sizes this widget supports; the layout engine refuses placing it at any other size. */
  sizes: WidgetSize[];
  /** Bus topics (exact or `prefix/*` wildcard, matching `apps/core/src/bus/index.ts`'s `topicMatches`) this widget needs. */
  topics: string[];
  /** Pure render function -- see `WidgetRenderContext`. */
  render: (ctx: WidgetRenderContext<TSettings>) => ReactNode;
  /** Optional settings contract (see `WidgetSettingsSchema`). */
  settings?: WidgetSettingsSchema<TSettings>;
}
