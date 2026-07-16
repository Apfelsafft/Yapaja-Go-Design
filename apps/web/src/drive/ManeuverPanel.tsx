/**
 * Maneuver panel (E04-T3, docs/06 §5) -- Drive BASICS; the full Drive UI
 * (lane assist, follow-camera, etc.) ships in E07. Always shows: arrow icon,
 * distance (counts down as `nav/state` ticks in at 1 Hz), street name, and
 * the FOLLOWING maneuver when it's < 300 m after the current one.
 *
 * Hidden entirely outside an active drive (idle/routing/arrived) -- so it
 * never interferes with any other screen/testid; every existing e2e spec
 * never starts navigation, so this component simply never renders for them.
 */

import React from 'react';
import type { Maneuver, NavState } from '@yapaja/shared';
import { useNavState, useNavStore } from './navStore.js';
import { useRoutingStore } from '../routing/store.js';
import { ManeuverArrow } from './arrows.js';
import { formatDistance } from '../routing/format.js';

const DRIVE_ACTIVE_STATUSES: ReadonlySet<NavState['status']> = new Set(['navigating', 'off_route', 'paused']);

/** Whether the Drive UI (maneuver panel, speed sign, TTS) should be shown for this `nav/state` status. */
export function isDriveActive(status: NavState['status'] | null | undefined): boolean {
  return status != null && DRIVE_ACTIVE_STATUSES.has(status);
}

export interface FollowingManeuver {
  type: Maneuver['type'];
  street: string | null;
}

/**
 * The maneuver AFTER `maneuver`, when it's close enough to preview
 * (docs/06 §5: "Folgemanöver < 300 m dahinter"). `maneuver.distance_m` IS
 * that gap: `Route.maneuvers[i].distance_m` is defined as the length of
 * maneuver i's own road segment -- i.e. exactly the distance from finishing
 * `maneuver` to the NEXT one -- so no extra geometry lookup is needed, only
 * the full route's maneuver list (from the routing store) to find `index+1`.
 */
export function findFollowingManeuver(
  maneuver: Maneuver,
  routeManeuvers: readonly Maneuver[] | undefined,
): FollowingManeuver | null {
  if (maneuver.distance_m >= 300 || !routeManeuvers) return null;
  const next = routeManeuvers.find((m) => m.index === maneuver.index + 1);
  if (!next) return null;
  return { type: next.type, street: next.street_names[0] ?? null };
}

export default function ManeuverPanel(): React.ReactElement | null {
  const navState = useNavState();
  const routes = useRoutingStore((state) => state.routes);
  // W-19 (E04-T5): stays hidden until any reload-recovery prompt is
  // acknowledged, even if `navState` already reports an active session --
  // see `navStore.ts#useDriveGateOpen`'s doc comment.
  const driveGateOpen = useNavStore((state) => state.resumeAcknowledged);

  if (!navState || !driveGateOpen || !isDriveActive(navState.status)) return null;
  const maneuver = navState.next_maneuver;
  if (!maneuver) return null;

  const distanceM = navState.distance_to_maneuver_m ?? 0;
  const street = maneuver.street_names[0] ?? null;
  const activeRoute = routes.find((r) => r.id === navState.route_id);
  const following = findFollowingManeuver(maneuver, activeRoute?.maneuvers);

  return (
    <div
      data-testid="maneuver-panel"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-2xl bg-slate-900/90 text-white px-4 py-3 shadow-lg pointer-events-none"
    >
      <ManeuverArrow type={maneuver.type} className="shrink-0" />
      <div className="flex flex-col">
        <span data-testid="maneuver-distance" className="text-xl font-bold leading-tight tabular-nums">
          {formatDistance(distanceM)}
        </span>
        {street && (
          <span data-testid="maneuver-street" className="text-sm text-slate-200 leading-tight">
            {street}
          </span>
        )}
      </div>
      {following && (
        <div
          data-testid="maneuver-following"
          className="flex items-center gap-1 pl-3 ml-1 border-l border-white/30 text-slate-300"
        >
          <ManeuverArrow type={following.type} size={24} />
          {following.street && <span className="text-xs">{following.street}</span>}
        </div>
      )}
    </div>
  );
}
