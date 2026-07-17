/**
 * Altitude widget (E07-T1: "Höhe (aus Position.alt)"). Reads directly from
 * `Position.alt` -- NOT `NavState.altitude_m` -- so it keeps working in
 * Explore mode too (the Core only publishes `nav/state` while
 * navigating/off_route, see `apps/core/src/navigation/service.ts#onPosition`,
 * but `pos/update` is published any time a fix arrives regardless of nav
 * status).
 */

import type { Widget } from '@yapaja/ui';
import { latestPosition } from './positionUtils.js';

export const altitudeWidget: Widget = {
  id: 'altitude',
  name: 'Höhe',
  sizes: ['S'],
  topics: ['pos/update', 'pos/extrapolated'],
  render: ({ data }) => {
    const position = latestPosition(data);
    const alt = position?.alt;
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span data-testid="widget-altitude-value" className="text-2xl font-bold tabular-nums">
          {alt != null ? `${Math.round(alt)} m` : '–'}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-400">⛰ Höhe</span>
      </div>
    );
  },
};
