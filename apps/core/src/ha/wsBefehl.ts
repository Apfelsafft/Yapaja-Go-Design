/* eslint-disable no-undef -- `WebSocket`/`setTimeout` sind Standard-Globale in Node 22. */
/**
 * Ein einzelner Befehl über die WebSocket-Schnittstelle von Home Assistant.
 *
 * Manches gibt es nur dort, nicht über REST -- etwa die Liste der Stimmen
 * mit ihren Sprachen (`tts/engine/list`). Verbinden, anmelden, EINEN Befehl
 * schicken, die Antwort zurückgeben, schließen.
 *
 * Wirft nie: `null` heißt „keine Antwort" (nicht erreichbar, abgelehnt,
 * Zeitlimit oder `success: false`).
 */

import type { HaConnection } from './config.js';
import { wsUrlFor, type WebSocketAehnlich } from './commandHelpers.js';

export interface WsBefehlDeps {
  erzeugeSocket?: (url: string) => WebSocketAehnlich;
  timeoutMs?: number;
}

export async function wsBefehl(
  verbindung: HaConnection,
  befehl: Record<string, unknown>,
  deps: WsBefehlDeps = {},
): Promise<unknown> {
  const erzeuge = deps.erzeugeSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketAehnlich);
  return new Promise((fertig) => {
    let socket: WebSocketAehnlich | null = null;
    let erledigt = false;
    const ende = (ergebnis: unknown): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      try {
        socket?.close();
      } catch {
        // egal
      }
      fertig(ergebnis);
    };
    const uhr = setTimeout(() => ende(null), deps.timeoutMs ?? 8_000);
    try {
      socket = erzeuge(wsUrlFor(verbindung.apiBase));
    } catch {
      ende(null);
      return;
    }
    socket.addEventListener('error', () => ende(null));
    socket.addEventListener('close', () => ende(null));
    socket.addEventListener('message', (e) => {
      let n: Record<string, unknown>;
      try {
        n = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (n.type === 'auth_required') socket?.send(JSON.stringify({ type: 'auth', access_token: verbindung.token }));
      else if (n.type === 'auth_invalid') ende(null);
      else if (n.type === 'auth_ok') socket?.send(JSON.stringify({ id: 1, ...befehl }));
      else if (n.type === 'result' && n.id === 1) ende(n.success === true ? (n.result ?? null) : null);
    });
  });
}
