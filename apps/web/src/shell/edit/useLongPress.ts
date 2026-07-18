/**
 * Generic long-press detector (E07-T2 acceptance criterion 1: "Enter edit
 * mode via long-press (600 ms) on free UI area"). Pointer-events based (not
 * touch/mouse-specific handlers) so it works identically for touch and mouse,
 * same rationale as `@dnd-kit/core`'s `PointerSensor` used for drag/drop.
 *
 * A press is cancelled (no `onLongPress` call) if the pointer moves more
 * than `moveTolerancePx` before the timer fires, or is released/leaves
 * early -- both are the difference between "a long press" and "a drag" or
 * "a normal tap".
 */

import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const DEFAULT_DURATION_MS = 600;
const DEFAULT_MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerLeave: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
}

export interface UseLongPressOptions {
  durationMs?: number;
  moveTolerancePx?: number;
  /** Long-press is disabled entirely (e.g. already in edit mode -- dragging
   *  widgets around must never re-trigger entry). */
  disabled?: boolean;
}

export function useLongPress(onLongPress: () => void, options: UseLongPressOptions = {}): LongPressHandlers {
  const { durationMs = DEFAULT_DURATION_MS, moveTolerancePx = DEFAULT_MOVE_TOLERANCE_PX, disabled = false } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const clear = (): void => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  };

  return useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (event) => {
        if (disabled || event.button !== 0) return;
        // Only a long-press on the truly EMPTY free area, never on a widget
        // or any other interactive child -- otherwise every ordinary tap on
        // a widget would risk (after 600ms of an accidental hold) yanking
        // the user into edit mode mid-interaction.
        if (event.target !== event.currentTarget) return;
        originRef.current = { x: event.clientX, y: event.clientY };
        if (timerRef.current != null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onLongPress();
        }, durationMs);
      },
      onPointerMove: (event) => {
        if (!originRef.current) return;
        const dx = event.clientX - originRef.current.x;
        const dy = event.clientY - originRef.current.y;
        if (Math.hypot(dx, dy) > moveTolerancePx) clear();
      },
      onPointerUp: () => clear(),
      onPointerLeave: () => clear(),
      onPointerCancel: () => clear(),
    }),
    [disabled, durationMs, moveTolerancePx, onLongPress],
  );
}
