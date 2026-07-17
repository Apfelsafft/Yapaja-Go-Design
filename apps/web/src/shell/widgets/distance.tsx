/**
 * Remaining-distance widget (E07-T1, docs/06 Section 1 drive-mode sketch:
 * "213 km"). Reuses `formatDistance` (E03-T3's single formatter -- "the
 * displayed distance must equal the API's value, routed through exactly ONE
 * formatter").
 */

import type { NavState } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';
import { formatDistance } from '../../routing/format.js';

export const distanceWidget: Widget = {
  id: 'distance',
  name: 'Restdistanz',
  sizes: ['S', 'M'],
  topics: ['nav/state'],
  render: ({ data }) => {
    const navState = data['nav/state'] as NavState | undefined;
    const meters = navState?.distance_remaining_m;
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span data-testid="widget-distance-value" className="text-2xl font-bold tabular-nums">
          {meters != null ? formatDistance(meters) : '–'}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-400">Restdistanz</span>
      </div>
    );
  },
};
