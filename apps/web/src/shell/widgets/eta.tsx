/**
 * ETA widget (E07-T1, docs/06 Section 1 drive-mode sketch: "ETA 17:42").
 * Uses `@yapaja/shared`'s `formatEta` (per the task spec) -- the Core
 * publishes `NavState.eta` as a UTC ISO-8601 instant; `formatEta` is the
 * ONE place that renders it as a local clock time (W-22, see
 * `packages/shared/src/formatEta.ts`'s doc comment) so every consumer
 * (this widget, MQTT-adjacent tooling, ...) agrees.
 */

import type { NavState } from '@yapaja/shared';
import { formatEta } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';

export const etaWidget: Widget = {
  id: 'eta',
  name: 'Ankunftszeit',
  sizes: ['S', 'M'],
  topics: ['nav/state'],
  render: ({ data }) => {
    const navState = data['nav/state'] as NavState | undefined;
    const eta = navState?.eta;
    let label = '–';
    if (eta) {
      try {
        label = formatEta(eta);
      } catch {
        label = '–'; // upstream sent a malformed ISO string -- never crash the widget over it
      }
    }
    return (
      <div className="flex flex-col items-center justify-center leading-none">
        <span data-testid="widget-eta-value" className="text-2xl font-bold tabular-nums">
          {label}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-400">ETA</span>
      </div>
    );
  },
};
