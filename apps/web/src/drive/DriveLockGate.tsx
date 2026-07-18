/**
 * Wraps a config/editor surface's content: renders `children` as normal
 * while unlocked, or `DriveLockOverlay` in its place while the Speed-Lock
 * (E07-T4) has `controlId` locked. The surface's own open/close toggle
 * (FAB, panel-open state, ...) is left completely untouched by this --
 * only what's rendered INSIDE the already-open surface changes, so a locked
 * Settings/Store/Profile-editor panel is still reachable (tap the FAB, see
 * the overlay + "Ich bin Beifahrer" button) rather than the FAB itself
 * becoming inert (which would hide the override path entirely).
 */

import React from 'react';
import { useIsControlLocked } from './driveLockStore.js';
import type { DriveControlId } from './driveLock.js';
import DriveLockOverlay from './DriveLockOverlay.js';

export interface DriveLockGateProps {
  controlId: DriveControlId;
  children: React.ReactNode;
}

export default function DriveLockGate({ controlId, children }: DriveLockGateProps): React.ReactElement {
  const locked = useIsControlLocked(controlId);
  if (locked) {
    return <DriveLockOverlay />;
  }
  return <>{children}</>;
}
