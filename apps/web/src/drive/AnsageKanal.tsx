/**
 * Der Browser als Ansage-Ziel für den Kern (`apps/core/src/ha/browserKanal.ts`).
 *
 * Gewünscht: „Schau bitte mal nach, ob alle Sprachausgaben denselben Weg
 * nehmen." Die Abbiege-Ansagen mischt dieser Browser schon selbst ein, wenn
 * das Radio hier über Beats Player läuft (`ansageZiel.ts`). Antworten der
 * Sprachsteuerung über Home Assistant Assist entstehen aber im Kern -- die
 * kamen bisher über Beat in den Stream, mit Sekunden Verzögerung.
 *
 * Solange Beats Player hier spielt, meldet sich der Browser alle paar
 * Sekunden beim Kern und hört auf `ansage/browser`. Kommt eine Ansage, wird
 * sie bestätigt (sonst mischt Beat) und hier eingemischt.
 */

import { useEffect } from 'react';
import { browserPlayer } from './ansageZiel.js';
import { buildWebSocketUrl, currentWsUrlLocation } from '../net/wsUrl.js';

const url = (pfad: string): string => `${import.meta.env.BASE_URL}${pfad}`;
export const MELDE_MS = 5_000;

export function nimmAnsage(nachricht: unknown): void {
  const n = nachricht as { id?: unknown; pfad?: unknown } | null;
  if (!n || typeof n.id !== 'string' || typeof n.pfad !== 'string') return;
  const player = browserPlayer();
  if (!player) return; // ein anderer Browser, oder hier spielt nichts: Beat übernimmt
  // sofort bestätigen -- der Kern wartet nur kurz, dann mischt Beat
  void fetch(url('api/v1/ansage/gespielt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: n.id, ok: true }),
  }).catch(() => undefined);
  void player.sprich(`${window.location.origin}${n.pfad}`);
}

export default function AnsageKanal(): null {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let zu = false;
    let neu: number | null = null;
    const verbinde = (): void => {
      if (zu) return;
      try {
        ws = new WebSocket(buildWebSocketUrl(import.meta.env.BASE_URL, currentWsUrlLocation()));
      } catch {
        return;
      }
      ws.addEventListener('open', () => ws?.send(JSON.stringify({ type: 'subscribe', topics: ['ansage/*'] })));
      ws.addEventListener('message', (e: MessageEvent<string>) => {
        try {
          const m = JSON.parse(e.data) as { topic?: string; payload?: unknown };
          if (m.topic === 'ansage/browser') nimmAnsage(m.payload);
        } catch {
          // keine Ansage
        }
      });
      ws.addEventListener('close', () => {
        ws = null;
        if (!zu) neu = window.setTimeout(verbinde, 5_000);
      });
    };
    const melde = (): void => {
      const p = browserPlayer();
      if (!p) return;
      if (!ws) verbinde();
      void fetch(url('api/v1/ansage/browser'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name }),
      }).catch(() => undefined);
    };
    melde();
    const takt = window.setInterval(melde, MELDE_MS);
    return () => {
      zu = true;
      window.clearInterval(takt);
      if (neu !== null) window.clearTimeout(neu);
      ws?.close();
    };
  }, []);
  return null;
}
