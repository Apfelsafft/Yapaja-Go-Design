/**
 * Clock widget (E07-T1). The only core widget that needs no bus topic at
 * all (`topics: []`) -- it just displays wall-clock time, ticking on its
 * own local interval rather than reacting to any shared-store update.
 */

import React, { useEffect, useState } from 'react';
import type { Widget } from '@yapaja/ui';

function formatClock(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function ClockDisplay(): React.ReactElement {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <span data-testid="widget-clock-value" className="text-lg font-bold tabular-nums">
      {formatClock(now)}
    </span>
  );
}

export const clockWidget: Widget = {
  id: 'clock',
  name: 'Uhrzeit',
  sizes: ['S'],
  topics: [],
  render: () => <ClockDisplay />,
};
