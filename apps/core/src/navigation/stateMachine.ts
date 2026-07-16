/**
 * NavigationService state machine (E04-T1).
 *
 * States (docs/03 §1 `NavState.status`):
 *   idle → routing → navigating ⇄ paused → arrived, with `off_route` a
 *   sub-state of navigating (matcher-driven, not a user action).
 *
 * Transitions happen ONLY via the actions below. `nextState` is a pure lookup
 * returning the target state, or `null` for an undefined (invalid) transition —
 * the REST layer maps a `null` result to HTTP 409.
 *
 * User actions (REST):   START, PAUSE, RESUME, STOP
 *   `start` = START (idle/arrived → routing) then ROUTE_READY (routing →
 *   navigating); the route is already computed by the routing service, so the
 *   `routing` state is transient in the T1 flow but modelled explicitly so the
 *   whole table is real and testable.
 * Internal actions (matcher / arrival detection): ROUTE_READY, DEVIATE, RETURN,
 *   ARRIVE. These are never rejected with 409 — they are driven by the service
 *   itself, only ever fired from a state where they are valid.
 */

export type NavStatus = 'idle' | 'routing' | 'navigating' | 'paused' | 'arrived' | 'off_route';

export type NavAction =
  | 'START'
  | 'ROUTE_READY'
  | 'PAUSE'
  | 'RESUME'
  | 'STOP'
  | 'DEVIATE'
  | 'RETURN'
  | 'ARRIVE';

export const NAV_STATUSES: readonly NavStatus[] = [
  'idle',
  'routing',
  'navigating',
  'paused',
  'arrived',
  'off_route',
];

export const NAV_ACTIONS: readonly NavAction[] = [
  'START',
  'ROUTE_READY',
  'PAUSE',
  'RESUME',
  'STOP',
  'DEVIATE',
  'RETURN',
  'ARRIVE',
];

/**
 * The authoritative transition table. A `(from, action)` pair absent here is an
 * invalid transition. Kept as data (not scattered `if`s) so the state-machine
 * table test can assert every cell.
 */
const TRANSITIONS: Record<NavStatus, Partial<Record<NavAction, NavStatus>>> = {
  idle: { START: 'routing' },
  routing: { ROUTE_READY: 'navigating', STOP: 'idle' },
  navigating: { PAUSE: 'paused', DEVIATE: 'off_route', ARRIVE: 'arrived', STOP: 'idle' },
  off_route: { RETURN: 'navigating', PAUSE: 'paused', ARRIVE: 'arrived', STOP: 'idle' },
  paused: { RESUME: 'navigating', STOP: 'idle' },
  arrived: { START: 'routing', STOP: 'idle' },
};

/** Target state for `(current, action)`, or `null` if the transition is invalid. */
export function nextState(current: NavStatus, action: NavAction): NavStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

/** Whether `(current, action)` is a defined transition. */
export function canTransition(current: NavStatus, action: NavAction): boolean {
  return nextState(current, action) !== null;
}
