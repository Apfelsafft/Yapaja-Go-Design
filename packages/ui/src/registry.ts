/**
 * Widget registry (E07-T1): a simple in-memory catalogue of `Widget`
 * definitions keyed by id. The slot-layout engine (`apps/web/src/shell/`)
 * looks widget instances up here to resolve a persisted layout; an id with
 * no registered widget (e.g. a deinstalled add-on) simply isn't returned --
 * see `apps/web/src/shell/layout.ts`'s `resolveSlotWidgets`, which is the
 * actual "skip unknown ids silently" robustness behaviour (docs E07-T1
 * acceptance criterion 4). This class only needs to never THROW on a lookup
 * miss; it does not decide what happens next.
 *
 * Kept as an instantiable class (not a module-level singleton) so tests can
 * build an isolated registry instead of mutating shared global state.
 */

import type { Widget } from './types.js';

export class WidgetRegistry {
  private readonly widgets = new Map<string, Widget>();

  /** Registers a widget. Throws if `id` is already registered -- a duplicate
   *  id is a programming bug (two widgets silently shadowing each other must
   *  never happen), never a case to swallow. */
  register(widget: Widget): void {
    if (this.widgets.has(widget.id)) {
      throw new Error(`WidgetRegistry: a widget with id "${widget.id}" is already registered`);
    }
    this.widgets.set(widget.id, widget);
  }

  /** Removes a widget by id. Returns `true` if one was present. Idempotent --
   *  used by the add-on runtime (E09-T2) to tear a disabled/uninstalled
   *  add-on's widget back out of the registry with no residue; a miss is the
   *  expected, non-exceptional case (already gone), never an error. */
  unregister(id: string): boolean {
    return this.widgets.delete(id);
  }

  /** Looks up a widget by id. Returns `undefined` for an unknown id -- this
   *  is the expected, non-exceptional path for a stale/uninstalled add-on
   *  widget id found in a persisted layout. */
  get(id: string): Widget | undefined {
    return this.widgets.get(id);
  }

  has(id: string): boolean {
    return this.widgets.has(id);
  }

  /** All registered widgets, insertion order. */
  list(): Widget[] {
    return [...this.widgets.values()];
  }
}
