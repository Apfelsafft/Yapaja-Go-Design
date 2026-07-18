/**
 * Widget Library drawer (E07-T2: "Widget Library drawer lists ALL registered
 * widgets (including ones not currently placed)"). Every entry is a
 * `@dnd-kit/core` drag source (`kind: 'library'`, see `editModel.ts`'s
 * `DragItemData`) -- dragging one onto a slot creates a brand-new instance
 * there (`Shell.tsx`'s `onDragEnd` -> `addWidgetInstance`); nothing here
 * mutates the draft directly.
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Widget } from '@yapaja/ui';
import type { WidgetRegistry } from '@yapaja/ui';
import type { DragItemData } from './editModel.js';

interface LibraryWidgetCardProps {
  widget: Widget;
}

function LibraryWidgetCard({ widget }: LibraryWidgetCardProps): React.ReactElement {
  const dragData: DragItemData = { kind: 'library', widgetId: widget.id };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `library:${widget.id}`,
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid={`library-widget-${widget.id}`}
      // Same "no DragOverlay, this node IS the drag visual" approach as
      // `Shell.tsx`'s `EditableWidgetInstance` -- see its comment.
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 60 : undefined }}
      className={`touch-none select-none cursor-grab rounded border border-slate-500 bg-slate-800/80 px-2 py-1.5 text-xs text-slate-100 shadow ${
        isDragging ? 'shadow-xl' : ''
      }`}
    >
      <div className="font-semibold">{widget.name}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{widget.sizes.join(' / ')}</div>
    </div>
  );
}

export interface WidgetLibraryDrawerProps {
  registry: WidgetRegistry;
}

export function WidgetLibraryDrawer({ registry }: WidgetLibraryDrawerProps): React.ReactElement {
  const widgets = registry.list();

  return (
    <div
      data-testid="widget-library"
      className="fixed left-2 top-2 bottom-2 z-50 flex w-40 flex-col gap-2 overflow-y-auto rounded-lg bg-slate-900/95 p-2 shadow-lg"
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Widget-Bibliothek</div>
      {widgets.map((widget) => (
        <LibraryWidgetCard key={widget.id} widget={widget} />
      ))}
    </div>
  );
}
