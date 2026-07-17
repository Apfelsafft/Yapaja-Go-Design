/**
 * Speed-limit widget (E07-T1): reuses the existing `SpeedLimitSign`
 * component (E04-T3) wholesale, passing it the `NavState` the widget shell
 * received over ITS OWN shared connection (rather than letting the
 * component fall back to `navStore`'s dedicated one -- see
 * `SpeedLimitSign.tsx`'s `SpeedLimitSignProps` doc comment and
 * `shell/wsStore.ts`'s module doc comment for the connection boundary).
 */

import type { NavState } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';
import SpeedLimitSign from '../../drive/SpeedLimitSign.js';

export const speedLimitWidget: Widget = {
  id: 'speed-limit',
  name: 'Tempolimit',
  sizes: ['S'],
  topics: ['nav/state'],
  render: ({ data }) => {
    const navState = (data['nav/state'] as NavState | undefined) ?? null;
    return <SpeedLimitSign navState={navState} driveGateOpen />;
  },
};
