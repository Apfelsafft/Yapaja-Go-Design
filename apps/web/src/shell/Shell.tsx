/**
 * The slot-layout engine's render tree (E07-T1): renders every slot
 * (docs/05 Section 4) for the active mode, resolving each slot's persisted
 * widget instances against the registry (unknown ids silently skipped, see
 * `layout.ts#resolveSlotWidgets`), and wiring the shared WS connection to
 * the exact union of topics the CURRENTLY resolved widgets need.
 */

import React, { useEffect, useMemo } from 'react';
import type { ShellMode, SlotId, Widget } from '@yapaja/ui';
import { SLOT_IDS } from '@yapaja/ui';
import { resolveSlotWidgets, type WidgetInstance } from './layout.js';
import { useLayoutStore } from './layoutStore.js';
import { shellWidgetRegistry } from './widgets/registry.js';
import { shellWsManager, useShellWsStore } from './wsStore.js';
import { useWidgetData } from './useWidgetData.js';

interface WidgetHostProps {
  instance: WidgetInstance;
  widget: Widget;
  mode: ShellMode;
}

function WidgetHost({ instance, widget, mode }: WidgetHostProps): React.ReactElement {
  const data = useWidgetData(widget.topics);
  const connected = useShellWsStore((state) => state.connected);

  return (
    <div data-testid={`widget-${widget.id}`} role="group" aria-label={widget.name}>
      {widget.render({
        size: instance.size,
        mode,
        data,
        connected,
        settings: widget.settings?.defaults,
      })}
    </div>
  );
}

interface SlotProps {
  slotId: SlotId;
  instances: WidgetInstance[];
  mode: ShellMode;
}

function Slot({ slotId, instances, mode }: SlotProps): React.ReactElement {
  const resolved = useMemo(() => resolveSlotWidgets(instances, shellWidgetRegistry), [instances]);

  return (
    <div data-testid={`slot-${slotId}`} data-slot={slotId} className="flex flex-wrap items-center gap-3">
      {resolved.map(({ instance, widget }) => (
        <WidgetHost key={instance.instanceId} instance={instance} widget={widget} mode={mode} />
      ))}
    </div>
  );
}

export interface ShellProps {
  mode: ShellMode;
}

export default function Shell({ mode }: ShellProps): React.ReactElement | null {
  const ready = useLayoutStore((state) => state.ready);
  const init = useLayoutStore((state) => state.init);
  const modeLayout = useLayoutStore((state) => state.layouts[mode]);

  // Boot-time reconciliation (local cache + server, newest-timestamp-wins) --
  // see `persistence.ts#loadAndReconcileLayouts`.
  useEffect(() => {
    void init();
    // `init` is a stable module-level store action -- deliberately NOT in
    // the dep array, since re-running the local/server reconciliation on
    // every render would be pointless (and wasteful against the Core).
  }, []);

  // The single shared `/ws/v1` connection (see `wsStore.ts`'s doc comment):
  // opened exactly once here, for the lifetime of the Shell.
  useEffect(() => {
    void shellWsManager.connect();
    return () => shellWsManager.disconnect();
  }, []);

  // The union of topics every widget CURRENTLY resolved in this mode's
  // layout needs. Recomputed whenever the resolved layout changes (mode
  // switch, or a layout edit once E07-T2 ships) -- `setTopics` below then
  // resends the full subscription set over the SAME connection.
  const allTopics = useMemo(() => {
    const topics = new Set<string>();
    for (const slotId of SLOT_IDS) {
      const resolved = resolveSlotWidgets(modeLayout?.slots[slotId] ?? [], shellWidgetRegistry);
      for (const { widget } of resolved) {
        for (const topic of widget.topics) topics.add(topic);
      }
    }
    return [...topics].sort();
  }, [modeLayout]);

  useEffect(() => {
    shellWsManager.setTopics(allTopics);
  }, [allTopics]);

  // Avoid a flash of the built-in defaults before local/server reconciliation
  // resolves (usually sub-frame, but never guaranteed synchronous).
  if (!ready || !modeLayout) return null;

  return (
    // `w-screen h-screen` (viewport units, matching `App.tsx`'s own root div)
    // rather than `w-full h-full`: a percentage height only resolves against
    // an ancestor with an EXPLICIT height, which nothing in `shell.html`
    // sets up -- with an empty layout (explore mode's default, see
    // `layout.ts`) there is no content to size the box either, so `h-full`
    // collapses to a genuine 0px and the shell-root becomes invisible
    // (0-height elements fail Playwright's/the DOM's own visibility check)
    // even though it's correctly mounted and rendering zero widgets on purpose.
    <div data-testid="shell-root" data-mode={mode} className="relative w-screen h-screen">
      {SLOT_IDS.map((slotId) => (
        <Slot key={slotId} slotId={slotId} instances={modeLayout.slots[slotId]} mode={mode} />
      ))}
    </div>
  );
}
