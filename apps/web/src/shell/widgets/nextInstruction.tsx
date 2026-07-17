/**
 * Next-instruction widget (E07-T1): reuses the existing `ManeuverPanel`
 * component (E04-T3) wholesale, passing it the `NavState` the widget shell
 * received over its OWN shared connection (see `speedLimit.tsx`'s identical
 * reasoning and `shell/wsStore.ts`'s connection-boundary doc comment).
 * `driveGateOpen` is hard-`true` -- the widget shell has no W-19
 * reload-recovery-prompt concept of its own to gate on.
 */

import type { NavState } from '@yapaja/shared';
import type { Widget } from '@yapaja/ui';
import ManeuverPanel from '../../drive/ManeuverPanel.js';

export const nextInstructionWidget: Widget = {
  id: 'next-instruction',
  name: 'Nächste Anweisung',
  sizes: ['L'],
  topics: ['nav/state'],
  render: ({ data }) => {
    const navState = (data['nav/state'] as NavState | undefined) ?? null;
    return <ManeuverPanel navState={navState} driveGateOpen />;
  },
};
