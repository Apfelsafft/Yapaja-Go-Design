/**
 * React hook that extracts just a widget's own declared topics' latest
 * payloads out of the shared `wsStore` (E07-T1). Widgets never touch
 * `useShellWsStore` directly -- this is the only seam between "the shared
 * connection" and "what one widget instance's `render(ctx)` sees".
 */

import { useShellWsStore } from './wsStore.js';
import { shallow } from 'zustand/shallow';

/** Returns `{ [topic]: latestPayload }` for exactly the given topics --
 *  absent keys mean no message has arrived for that topic yet. Uses a
 *  shallow-equality comparator so a widget only re-renders when one of ITS
 *  OWN topics actually changed, not on every message the shared connection
 *  receives for some other widget's topic. */
export function useWidgetData(topics: string[]): Record<string, unknown> {
  return useShellWsStore((state) => {
    const result: Record<string, unknown> = {};
    for (const topic of topics) {
      if (topic in state.data) {
        result[topic] = state.data[topic];
      }
    }
    return result;
  }, shallow);
}
