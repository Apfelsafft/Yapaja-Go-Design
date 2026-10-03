import { describe, expect, it } from 'vitest';
import { wsBefehlErgebnis } from './wsBefehl.js';
import type { WebSocketAehnlich } from './commandHelpers.js';

const V = { apiBase: 'http://ha/api', token: 't' };

/** Ein Home Assistant, der auf den Befehl mit `antwort` reagiert (oder gar nicht). */
function socket(antwort: Record<string, unknown> | null) {
  return (): WebSocketAehnlich => {
    const hoerer: Record<string, Array<(e: { data: unknown }) => void>> = {};
    const raus = (n: unknown): void => {
      void Promise.resolve().then(() => hoerer.message?.forEach((h) => h({ data: JSON.stringify(n) })));
    };
    return {
      send: (d: string) => {
        const n = JSON.parse(d) as { type: string };
        if (n.type === 'auth') raus({ type: 'auth_ok' });
        else if (antwort) raus({ id: 1, type: 'result', ...antwort });
      },
      close: () => undefined,
      addEventListener: ((typ: string, h: (e: { data: unknown }) => void) => {
        (hoerer[typ] ??= []).push(h);
        if (typ === 'message') raus({ type: 'auth_required' });
      }) as WebSocketAehnlich['addEventListener'],
    };
  };
}

describe('wsBefehlErgebnis', () => {
  it('liefert das Ergebnis', async () => {
    const e = await wsBefehlErgebnis(V, { type: 'x' }, { erzeugeSocket: socket({ success: true, result: { a: 1 } }) });
    expect(e).toEqual({ ok: true, result: { a: 1 } });
  });

  it('gibt die Fehlermeldung von Home Assistant weiter', async () => {
    const e = await wsBefehlErgebnis(
      V,
      { type: 'call_service' },
      { erzeugeSocket: socket({ success: false, error: { code: 'home_assistant_error', message: 'Language de not supported' } }) },
    );
    expect(e).toEqual({ ok: false, fehler: 'Language de not supported' });
  });

  it('keine Antwort: zeitUm statt Fehler', async () => {
    const e = await wsBefehlErgebnis(V, { type: 'call_service' }, { erzeugeSocket: socket(null), timeoutMs: 30 });
    expect(e.ok).toBe(false);
    expect(e.zeitUm).toBe(true);
  });
});
