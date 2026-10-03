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
  const e = await wsBefehlErgebnis(verbindung, befehl, deps);
  return e.ok ? (e.result ?? null) : null;
}

export interface WsErgebnis {
  ok: boolean;
  result?: unknown;
  /** Die Fehlermeldung von Home Assistant, in seinen Worten. */
  fehler?: string;
  /** Keine Antwort binnen `timeoutMs` -- bei einer laufenden Aktion (eine
   *  Ansage dauert, bis sie gesprochen ist) heißt das nicht „Fehler". */
  zeitUm?: boolean;
}

/**
 * Wie {@link wsBefehl}, aber mit der Fehlermeldung von Home Assistant. Die
 * REST-Schnittstelle antwortet bei einer fehlgeschlagenen Aktion nur mit
 * einem Status; über WebSocket sagt Home Assistant, was nicht ging (etwa
 * „Sprache nicht unterstützt").
 */
export async function wsBefehlErgebnis(
  verbindung: HaConnection,
  befehl: Record<string, unknown>,
  deps: WsBefehlDeps = {},
): Promise<WsErgebnis> {
  const erzeuge = deps.erzeugeSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketAehnlich);
  return new Promise<WsErgebnis>((fertig) => {
    let socket: WebSocketAehnlich | null = null;
    let erledigt = false;
    const ende = (ergebnis: WsErgebnis): void => {
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
    const uhr = setTimeout(() => ende({ ok: false, zeitUm: true, fehler: 'Home Assistant hat nicht rechtzeitig geantwortet.' }), deps.timeoutMs ?? 8_000);
    try {
      socket = erzeuge(wsUrlFor(verbindung.apiBase));
    } catch {
      ende({ ok: false, fehler: 'Home Assistant ist nicht erreichbar.' });
      return;
    }
    socket.addEventListener('error', () => ende({ ok: false, fehler: 'Home Assistant ist nicht erreichbar.' }));
    socket.addEventListener('close', () => ende({ ok: false, fehler: 'Home Assistant hat die Verbindung beendet.' }));
    socket.addEventListener('message', (e) => {
      let n: Record<string, unknown>;
      try {
        n = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (n.type === 'auth_required') socket?.send(JSON.stringify({ type: 'auth', access_token: verbindung.token }));
      else if (n.type === 'auth_invalid') ende({ ok: false, fehler: 'Home Assistant hat die Anmeldung abgelehnt.' });
      else if (n.type === 'auth_ok') socket?.send(JSON.stringify({ id: 1, ...befehl }));
      else if (n.type === 'result' && n.id === 1) {
        if (n.success === true) ende({ ok: true, result: n.result ?? null });
        else {
          const f = n.error as { message?: unknown; code?: unknown } | undefined;
          ende({ ok: false, fehler: typeof f?.message === 'string' ? f.message : typeof f?.code === 'string' ? f.code : undefined });
        }
      }
    });
  });
}
