/**
 * Speed widget (E07-T1, docs/06 Section 1 drive-mode sketch: "87 km/h").
 * Large, tabular/lining figures so the digits don't jitter as the value
 * changes (docs/06 Section 3: "tabellarische Ziffern für Tempo/ETA").
 */

import type { NavState } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';

export const speedWidget: Widget = {
  id: 'speed',
  name: 'Tempo',
  sizes: ['M', 'L'],
  topics: ['nav/state'],
  render: ({ data, size }) => {
    const navState = data['nav/state'] as NavState | undefined;
    const kmh = navState?.speed_kmh;
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span
          data-testid="widget-speed-value"
          className={`font-extrabold tabular-nums ${size === 'L' ? 'text-5xl' : 'text-3xl'}`}
        >
          {kmh != null ? Math.round(kmh) : '–'}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-400">km/h</span>
      </div>
    );
  },
};
