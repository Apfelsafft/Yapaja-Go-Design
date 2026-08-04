/**
 * Ereignis-Beobachter auf dem Core-Event-Bus -- aus dem NODE-Prozess heraus,
 * ueber eine eigene `/ws/v1`-Verbindung.
 *
 * WARUM NICHT IM BROWSER MESSEN
 * -----------------------------
 * Die Messseite laeuft unter 4x-CPU-Drosselung und rastert die Karte in
 * Software; ein Frame dauert dort ~110 ms. Eine WS-Nachricht, die waehrend
 * eines Frames eintrifft, wird von der Seite entsprechend spaeter verarbeitet.
 * Real gemessen an der Reroute-Latenz: ueber den Browser-Store beobachtet
 * ergaben sich [242, 125, 216, 10, 251] ms fuer einen Vorgang, der ueber
 * dieselbe Beobachtung aus Node heraus bei ~11 ms liegt -- die Streuung war
 * die Frame-Zeit des Messcontainers, nicht das Produkt.
 *
 * Dieser Beobachter haengt daher direkt am Bus: keine Drosselung, kein
 * Rendering, kein Polling, Aufloesung im Sub-Millisekunden-Bereich. Er
 * ERSETZT nicht die UI-Pruefung -- die Specs pruefen den Endzustand
 * weiterhin zusaetzlich in der Oberflaeche.
 *
 * Benutzt `ws` (bereits Wurzel-devDependency, u. a. von den Core-Tests).
 */

import { WebSocket } from 'ws';

export interface BusMessage {
  readonly topic: string;
  readonly payload: unknown;
  /** `Date.now()` beim Eintreffen im Testprozess (Wandzeit, 1-ms-Aufloesung). */
  readonly receivedAt: number;
  /**
   * `performance.now()` beim Eintreffen -- monoton, Sub-Mikrosekunden.
   * Nur gegen einen `performance.now()`-Wert AUS DEMSELBEN PROZESS
   * vergleichbar. Die Reroute-Messung braucht das: ihre Messgroesse liegt bei
   * ~3 ms, da ist die 1-ms-Rasterung von `Date.now()` bereits ein Drittel des
   * Messwerts.
   */
  readonly receivedAtHrMs: number;
}

export type BusMatcher = (message: BusMessage) => boolean;

export interface BusObserver {
  /**
   * Wartet auf die naechste passende Nachricht und liefert sie.
   * Nachrichten, die VOR dem Aufruf eintrafen, werden nicht nachgereicht --
   * der Beobachter wird deshalb vor dem beobachteten Vorgang scharfgestellt.
   */
  waitFor(matcher: BusMatcher, timeoutMs: number): Promise<BusMessage>;
  close(): Promise<void>;
}

export async function observeBus(baseUrl: string, topics: readonly string[]): Promise<BusObserver> {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws/v1`;
  const socket = new WebSocket(wsUrl);
  const waiters: { matcher: BusMatcher; resolve: (m: BusMessage) => void }[] = [];

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', topics: [...topics] }));

  socket.on('message', (raw) => {
    const receivedAtHrMs = performance.now();
    const receivedAt = Date.now();
    let parsed: { topic?: unknown; payload?: unknown };
    try {
      parsed = JSON.parse(String(raw)) as { topic?: unknown; payload?: unknown };
    } catch {
      return;
    }
    if (typeof parsed.topic !== 'string') return;
    const message: BusMessage = {
      topic: parsed.topic,
      payload: parsed.payload,
      receivedAt,
      receivedAtHrMs,
    };
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].matcher(message)) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    waitFor(matcher, timeoutMs) {
      return new Promise<BusMessage>((resolve, reject) => {
        const entry = {
          matcher,
          resolve: (m: BusMessage) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Keine passende Bus-Nachricht binnen ${timeoutMs} ms (${topics.join(', ')})`));
        }, timeoutMs);
        waiters.push(entry);
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      });
    },
  };
}
