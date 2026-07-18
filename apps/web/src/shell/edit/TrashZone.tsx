/**
 * Trash drop zone (E07-T2: "remove (drag onto a trash zone)"). A
 * `@dnd-kit/core` droppable with a fixed id (`'trash'`) that `Shell.tsx`'s
 * `onDragEnd` checks for -- dropping an INSTANCE drag here removes it from
 * the draft; dropping a library drag here is simply ignored (nothing was
 * placed yet, so there's nothing to remove).
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';

export function TrashZone(): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash' });

  return (
    <div
      ref={setNodeRef}
      data-testid="edit-trash-zone"
      aria-label="Widget entfernen"
      title="Hierher ziehen zum Entfernen"
      className={`fixed bottom-4 right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed text-2xl transition-colors ${
        isOver ? 'border-red-500 bg-red-500/30 text-red-100' : 'border-slate-400 bg-slate-800/80 text-slate-300'
      }`}
    >
      🗑
    </div>
  );
}
