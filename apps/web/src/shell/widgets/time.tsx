/**
 * Remaining-time widget (E07-T1): `NavState.duration_remaining_s`, formatted
 * with `formatDuration` (`apps/web/src/routing/format.ts`, the same
 * formatter the route-summary panel uses).
 */

import type { NavState } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';
import { formatDuration } from '../../routing/format.js';

export const timeWidget: Widget = {
  id: 'time',
  name: 'Restzeit',
  sizes: ['S', 'M'],
  topics: ['nav/state'],
  render: ({ data }) => {
    const navState = data['nav/state'] as NavState | undefined;
    const seconds = navState?.duration_remaining_s;
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span data-testid="widget-time-value" className="text-2xl font-bold tabular-nums">
          {seconds != null ? formatDuration(seconds) : '–'}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-400">Restzeit</span>
      </div>
    );
  },
};
