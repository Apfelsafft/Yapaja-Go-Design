/**
 * The slot-layout engine's render tree (E07-T1): renders every slot
 * (docs/05 Section 4) for the active mode, resolving each slot's persisted
 * widget instances against the registry (unknown ids silently skipped, see
 * `layout.ts#resolveSlotWidgets`), and wiring the shared WS connection to
 * the exact union of topics the CURRENTLY resolved widgets need.
 *
 * E07-T2 adds the Edit mode on top of this, gated so the NON-edit render
 * path is byte-identical to before:
 *  - Entry: a long-press (600ms, `edit/useLongPress.ts`) on the free shell
 *    background, OR the always-visible "settings entry" button
 *    (`data-testid="edit-mode-enter-button"`) -- both funnel into the same
 *    `enterEditMode`, which snapshots the CURRENT saved layout into a DRAFT
 *    (`draftSlots`) and only then flips `editActive`. Entry is refused
 *    (button disabled) unless the vehicle is at a standstill (< 5 km/h, read
 *    from the `pos/update` topic -- `editModel.ts#isStandstill`).
 *  - While editing, every mutation (drag between slots, drag from the Widget
 *    Library, drag onto the trash zone, tap-to-cycle-size, Reset) mutates
 *    ONLY `draftSlots` -- `layoutStore.ts` is never touched until Save.
 *  - Save calls `useLayoutStore.replaceModeLayout(mode, draftSlots)` (the
 *    SAME persistence path E07-T1 already proved reload-durable). Cancel
 *    just discards `draftSlots` and flips `editActive` off -- the saved
 *    layout was never touched, so there is nothing to undo.
 *  - Plausibility (task's IMPORTANT criterion): every placement attempt
 *    (move, add-from-library) is checked by `editModel.ts#canPlaceInSlot`
 *    (widget size support AND slot size-capacity BOTH have to allow it) --
 *    an incompatible drop is refused (the mutator returns the draft
 *    UNCHANGED) and the hovered slot shows a red ring
 *    (`data-drop-invalid="true"`) the whole time it's hovered.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShellMode, SlotId, Widget } from '@yapaja/ui';
import { SLOT_IDS } from '@yapaja/ui';
import type { Position } from '@yapaja/shared';
import { resolveSlotWidgets, defaultLayout, type WidgetInstance, type SlotLayout } from './layout.js';
import { useLayoutStore } from './layoutStore.js';
import { shellWidgetRegistry } from './widgets/registry.js';
import { shellWsManager, useShellWsStore } from './wsStore.js';
import { useWidgetData } from './useWidgetData.js';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  canDropIntoSlot,
  cloneSlots,
  cycleWidgetInstanceSize,
  isStandstill,
  addWidgetInstance,
  moveWidgetInstance,
  removeWidgetInstance,
  type ActiveDragKind,
  type DragItemData,
} from './edit/editModel.js';
import { useLongPress } from './edit/useLongPress.js';
import { EditToolbar, ResetConfirmDialog } from './edit/EditToolbar.js';
import { WidgetLibraryDrawer } from './edit/WidgetLibraryDrawer.js';
import { TrashZone } from './edit/TrashZone.js';

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

interface EditableWidgetInstanceProps extends WidgetHostProps {
  onCycleSize: (instanceId: string) => void;
}

/** Edit-mode wrapper around ONE placed widget instance: draggable (move
 *  between slots / onto the trash zone), wobbling, with a tap-to-cycle size
 *  badge overlaid. Keeps the SAME `data-testid="widget-<id>"` as the
 *  non-edit `WidgetHost` so an e2e flow can find a moved widget by id
 *  regardless of which slot it's currently in. */
function EditableWidgetInstance({ instance, widget, mode, onCycleSize }: EditableWidgetInstanceProps): React.ReactElement {
  const data = useWidgetData(widget.topics);
  const connected = useShellWsStore((state) => state.connected);
  const dragData: DragItemData = {
    kind: 'instance',
    instanceId: instance.instanceId,
    widgetId: widget.id,
    size: instance.size,
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: instance.instanceId,
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid={`widget-${widget.id}`}
      data-instance-id={instance.instanceId}
      data-dragging={isDragging || undefined}
      role="group"
      aria-label={widget.name}
      // No `DragOverlay` portal is used -- this SAME node is what visually
      // follows the pointer (via `transform`, `@dnd-kit/utilities`'s `CSS`
      // helper), so it needs a raised `zIndex` to render above sibling slot
      // content while dragging.
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 50 : undefined }}
      // `min-h-10 min-w-10`: some widgets render NOTHING while they have no
      // data yet (e.g. `next-instruction` before navigation starts, see
      // `nextInstruction.tsx`'s `ManeuverPanel` reuse) -- without a
      // guaranteed minimum box, that instance would be a literal 0x0
      // element in edit mode: impossible to grab/drag with a pointer, and
      // (the actual bug this comment is fixing) never satisfying
      // `pointerWithin`'s "does the pointer's target rect overlap the
      // droppable" activation check either.
      className={`relative min-h-10 min-w-10 touch-none select-none rounded border border-dashed border-sky-400/70 bg-slate-950/20 p-1 ${
        isDragging ? 'shadow-xl' : 'edit-wobble'
      }`}
    >
      <button
        type="button"
        data-testid={`edit-size-badge-${instance.instanceId}`}
        aria-label={`Größe wechseln (aktuell ${instance.size})`}
        title="Tippen, um die Größe zu wechseln"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onCycleSize(instance.instanceId);
        }}
        className="absolute -top-2 -right-2 z-10 rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
      >
        {instance.size}
      </button>
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
  editActive: boolean;
  activeDrag: ActiveDragKind | null;
  onCycleSize: (instanceId: string) => void;
}

function Slot({ slotId, instances, mode, editActive, activeDrag, onCycleSize }: SlotProps): React.ReactElement {
  const resolved = useMemo(() => resolveSlotWidgets(instances, shellWidgetRegistry), [instances]);
  // Safe to call unconditionally even when no `DndContext` is mounted
  // (non-edit render path) -- `@dnd-kit/core` falls back to an inert default
  // context, `disabled: true` makes it a permanent no-op either way.
  const droppable = useDroppable({ id: slotId, disabled: !editActive });

  const isOver = editActive && droppable.isOver;
  const isInvalid = isOver && activeDrag != null && !canDropIntoSlot(activeDrag, slotId);

  const baseClassName = 'flex flex-wrap items-center gap-3';
  const className = editActive
    ? `${baseClassName} edit-slot-grid min-h-12 min-w-12 rounded p-1 ${
        isInvalid
          ? 'ring-2 ring-red-500 bg-red-500/10'
          : isOver
            ? 'ring-2 ring-emerald-400'
            : 'ring-1 ring-slate-500/40'
      }`
    : baseClassName;

  return (
    <div
      ref={editActive ? droppable.setNodeRef : undefined}
      data-testid={`slot-${slotId}`}
      data-slot={slotId}
      data-edit-active={editActive || undefined}
      data-drop-invalid={isInvalid || undefined}
      className={className}
    >
      {resolved.map(({ instance, widget }) =>
        editActive ? (
          <EditableWidgetInstance
            key={instance.instanceId}
            instance={instance}
            widget={widget}
            mode={mode}
            onCycleSize={onCycleSize}
          />
        ) : (
          <WidgetHost key={instance.instanceId} instance={instance} widget={widget} mode={mode} />
        ),
      )}
    </div>
  );
}

function generateInstanceId(widgetId: string): string {
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `edit-${widgetId}-${unique}`;
}

export interface ShellProps {
  mode: ShellMode;
}

export default function Shell({ mode }: ShellProps): React.ReactElement | null {
  const ready = useLayoutStore((state) => state.ready);
  const init = useLayoutStore((state) => state.init);
  const modeLayout = useLayoutStore((state) => state.layouts[mode]);

  const [editActive, setEditActive] = useState(false);
  const [draftSlots, setDraftSlots] = useState<SlotLayout | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDragKind | null>(null);

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

  // The slots currently being displayed: the DRAFT while editing (so drags/
  // resizes/library-adds are visible immediately), otherwise the saved layout.
  const displaySlots = editActive && draftSlots ? draftSlots : modeLayout?.slots;

  // The union of topics every widget CURRENTLY resolved in `displaySlots`
  // needs, PLUS `pos/update` unconditionally -- the edit-mode standstill
  // gate (E07-T2 acceptance criterion 2) needs a live speed reading
  // regardless of whether any placed widget happens to need position data.
  const allTopics = useMemo(() => {
    const topics = new Set<string>(['pos/update']);
    for (const slotId of SLOT_IDS) {
      const resolved = resolveSlotWidgets(displaySlots?.[slotId] ?? [], shellWidgetRegistry);
      for (const { widget } of resolved) {
        for (const topic of widget.topics) topics.add(topic);
      }
    }
    return [...topics].sort();
  }, [displaySlots]);

  useEffect(() => {
    shellWsManager.setTopics(allTopics);
  }, [allTopics]);

  const currentSpeedMs = useShellWsStore((state) => {
    const position = state.data['pos/update'] as Position | undefined;
    return position ? position.speed : null;
  });
  const atStandstill = isStandstill(currentSpeedMs);

  const enterEditMode = useCallback(() => {
    if (editActive || !modeLayout) return;
    // Re-check at the moment of entry (the button's `disabled` state can lag
    // a render behind a just-arrived `pos/update` message).
    const position = useShellWsStore.getState().data['pos/update'] as Position | undefined;
    if (!isStandstill(position ? position.speed : null)) return;
    setDraftSlots(cloneSlots(modeLayout.slots));
    setEditActive(true);
  }, [editActive, modeLayout]);

  const longPressHandlers = useLongPress(enterEditMode, { disabled: editActive });

  const handleSave = useCallback(() => {
    if (!draftSlots) return;
    useLayoutStore.getState().replaceModeLayout(mode, draftSlots);
    setEditActive(false);
    setDraftSlots(null);
    setActiveDrag(null);
  }, [draftSlots, mode]);

  const handleCancel = useCallback(() => {
    setEditActive(false);
    setDraftSlots(null);
    setActiveDrag(null);
    setShowResetConfirm(false);
  }, []);

  const handleResetConfirmed = useCallback(() => {
    setDraftSlots(defaultLayout(mode).slots);
    setShowResetConfirm(false);
  }, [mode]);

  const handleCycleSize = useCallback((instanceId: string) => {
    setDraftSlots((prev) => {
      if (!prev) return prev;
      const result = cycleWidgetInstanceSize(prev, shellWidgetRegistry, instanceId);
      return result.ok ? result.slots : prev;
    });
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragItemData | undefined;
    if (!data) return;
    const widget = shellWidgetRegistry.get(data.widgetId);
    if (!widget) return;
    setActiveDrag(
      data.kind === 'instance'
        ? { kind: 'instance', widget, size: data.size }
        : { kind: 'library', widget, size: widget.sizes[0] },
    );
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);
    const data = event.active.data.current as DragItemData | undefined;
    const overId = event.over?.id;
    if (!data || overId == null) return;

    setDraftSlots((prev) => {
      if (!prev) return prev;

      if (overId === 'trash') {
        if (data.kind !== 'instance') return prev; // nothing placed yet to remove
        const result = removeWidgetInstance(prev, data.instanceId);
        return result.ok ? result.slots : prev;
      }

      const targetSlot = overId as SlotId;
      if (!(SLOT_IDS as readonly string[]).includes(targetSlot)) return prev;

      if (data.kind === 'instance') {
        const result = moveWidgetInstance(prev, shellWidgetRegistry, data.instanceId, targetSlot);
        return result.ok ? result.slots : prev;
      }

      const widget = shellWidgetRegistry.get(data.widgetId);
      if (!widget) return prev;
      const result = addWidgetInstance(prev, widget, targetSlot, generateInstanceId(widget.id));
      return result.ok ? result.slots : prev;
    });
  }, []);

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small activation distance distinguishes "tap the size badge" /
      // "long-press to enter edit mode" from an actual drag -- and, per the
      // task's touch-AND-mouse requirement, `PointerSensor` covers both
      // input types uniformly (no separate touch sensor needed).
      activationConstraint: { distance: 4 },
    }),
  );

  // Avoid a flash of the built-in defaults before local/server reconciliation
  // resolves (usually sub-frame, but never guaranteed synchronous).
  if (!ready || !modeLayout) return null;

  const slotsForRender = editActive && draftSlots ? draftSlots : modeLayout.slots;

  const slotElements = SLOT_IDS.map((slotId) => (
    <Slot
      key={slotId}
      slotId={slotId}
      instances={slotsForRender[slotId]}
      mode={mode}
      editActive={editActive}
      activeDrag={activeDrag}
      onCycleSize={handleCycleSize}
    />
  ));

  return (
    // `w-screen h-screen` (viewport units, matching `App.tsx`'s own root div)
    // rather than `w-full h-full`: a percentage height only resolves against
    // an ancestor with an EXPLICIT height, which nothing in `shell.html`
    // sets up -- with an empty layout (explore mode's default, see
    // `layout.ts`) there is no content to size the box either, so `h-full`
    // collapses to a genuine 0px and the shell-root becomes invisible
    // (0-height elements fail Playwright's/the DOM's own visibility check)
    // even though it's correctly mounted and rendering zero widgets on purpose.
    <div
      data-testid="shell-root"
      data-mode={mode}
      data-edit-active={editActive || undefined}
      className="relative w-screen h-screen"
      {...longPressHandlers}
    >
      {editActive ? (
        <DndContext
          sensors={sensors}
          // `pointerWithin` (pointer-position based) rather than the default
          // `rectIntersection` (overlap-AREA based): a widget with no
          // current data (e.g. `next-instruction` before navigation starts,
          // see `nextInstruction.tsx`) renders with zero size, so its
          // dragged rect would have zero intersection AREA with every
          // droppable -- `rectIntersection` would then never register an
          // `over` slot at all, regardless of where the pointer actually is.
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* `pl-44`: the Widget Library drawer is `fixed left-2 w-40` (168px
              total) -- without this, slot content flush against the left
              edge (e.g. `map-overlay-tl`'s default widget) would render
              UNDERNEATH the opaque, higher-z-index drawer, both visually
              hidden AND unreachable to pointer events (the drawer, not the
              widget, is what's actually on top and receives the click/drag). */}
          <div className="pl-44 pr-2 pt-1">{slotElements}</div>
          <WidgetLibraryDrawer registry={shellWidgetRegistry} />
          <TrashZone />
          <EditToolbar onSave={handleSave} onCancel={handleCancel} onRequestReset={() => setShowResetConfirm(true)} />
          {showResetConfirm && (
            <ResetConfirmDialog onConfirm={handleResetConfirmed} onCancel={() => setShowResetConfirm(false)} />
          )}
        </DndContext>
      ) : (
        <>
          {slotElements}
          <button
            type="button"
            data-testid="edit-mode-enter-button"
            aria-label="Widget-Layout bearbeiten"
            title={atStandstill ? 'Layout bearbeiten' : 'Nur im Stand verfügbar (< 5 km/h)'}
            disabled={!atStandstill}
            aria-disabled={!atStandstill}
            onClick={enterEditMode}
            className="fixed top-2 right-2 z-40 rounded bg-slate-800/85 px-3 py-1.5 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⚙ Bearbeiten
          </button>
        </>
      )}
    </div>
  );
}
