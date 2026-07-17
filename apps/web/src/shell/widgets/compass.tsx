/**
 * Compass widget (E07-T1): `Position.heading`, rendered as a rotated needle.
 * `null` heading (no fix yet, or a stationary GPS unit that doesn't report
 * course) shows a neutral dash rather than a fabricated "0°" (same
 * never-fabricate-zero discipline as the speed-limit sign).
 */

import type { Widget } from '@yapaja/ui';
import { latestPosition } from './positionUtils.js';

export const compassWidget: Widget = {
  id: 'compass',
  name: 'Kompass',
  sizes: ['S'],
  topics: ['pos/update', 'pos/extrapolated'],
  render: ({ data }) => {
    const heading = latestPosition(data)?.heading ?? null;
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span
          data-testid="widget-compass-needle"
          data-heading={heading ?? ''}
          className="inline-block text-xl"
          style={{ transform: heading != null ? `rotate(${heading}deg)` : undefined }}
        >
          ↑
        </span>
        <span data-testid="widget-compass-value" className="text-xs tabular-nums text-slate-400">
          {heading != null ? `${Math.round(heading)}°` : '–'}
        </span>
      </div>
    );
  },
};
