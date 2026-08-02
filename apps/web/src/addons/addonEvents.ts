/**
 * In-page fan-out for add-on `events.publish` (E09-T2, scope `events.publish`).
 *
 * The host has ALREADY enforced (in `bridge.ts`) that the topic is confined to
 * the add-on's own `addon/{id}/*` namespace before this is ever called. This
 * module just delivers the (already-validated, already-namespaced) event to
 * any in-page listener via a shared `EventTarget`. Bridging these to the Core
 * event bus / MQTT is a Service-add-on concern (E09-T3), out of scope for the
 * frontend runtime -- so this deliberately stays client-local.
 */

export interface AddonEvent {
  topic: string;
  payload: unknown;
}

const target = new EventTarget();
const EVENT_NAME = 'yapaja-addon-event';

export function publishAddonEvent(topic: string, payload: unknown): void {
  target.dispatchEvent(new CustomEvent<AddonEvent>(EVENT_NAME, { detail: { topic, payload } }));
}

export function subscribeAddonEvents(cb: (event: AddonEvent) => void): () => void {
  const handler = (e: Event): void => cb((e as CustomEvent<AddonEvent>).detail);
  target.addEventListener(EVENT_NAME, handler);
  return () => target.removeEventListener(EVENT_NAME, handler);
}
