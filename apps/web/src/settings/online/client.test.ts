/**
 * Der Zugang zu den Online-Diensten vom Browser aus.
 *
 * ─── DER PUNKT DIESER DATEI ─────────────────────────────────────────────────
 * Dass ein Fehler hier eine AUSKUNFT ist und kein Abbruch. Die Prüfung gibt
 * es genau für den Fall, dass etwas nicht klappt — würde sie dann selbst
 * werfen, stünde auf dem Bildschirm nichts, und der Betreiber wäre genau so
 * weit wie vorher.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fetchOnlineStatus, starteDiagnose } from './client';

const echt = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = echt;
});

function antwortet(status: number, koerper: unknown): void {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => koerper,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('starteDiagnose', () => {
  it('reicht Urteil und Zeilen durch', async () => {
    antwortet(200, { data: { urteil: 'alles gut', zeilen: [{ dienst: 'x', url: 'https://x' }] } });
    const r = await starteDiagnose();
    expect('zeilen' in r && r.zeilen).toHaveLength(1);
  });

  it('behält die Meldung des Kerns, statt sie zu ersetzen', async () => {
    // Sie sagt bereits, WO der Schalter sitzt. Eine eigene Formulierung
    // würde genau diese Auskunft verlieren.
    antwortet(409, {
      error: { code: 'ONLINE_DISABLED', message: 'Die Online-Dienste sind ausgeschaltet. …enabled' },
    });
    const r = await starteDiagnose();
    expect('fehler' in r && r.fehler).toContain('enabled');
  });

  it('wirft nicht, wenn gar nichts antwortet', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await starteDiagnose();
    expect('fehler' in r && r.fehler).toContain('Failed to fetch');
  });

  it('erkennt eine Antwort in unerwarteter Form', async () => {
    // Sonst liefe die Oberfläche auf `undefined.map` und zeigte einen
    // weissen Bildschirm statt eines Befunds.
    antwortet(200, { data: { urteil: 'x' } });
    const r = await starteDiagnose();
    expect('fehler' in r && r.fehler).toContain('erwartete Form');
  });

  it('schickt die Straße nur, wenn eine genannt ist', async () => {
    let koerper = '';
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      koerper = init?.body ?? '';
      return { ok: true, status: 200, json: async () => ({ data: { urteil: '', zeilen: [] } }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await starteDiagnose();
    expect(koerper).toBe('{}');
    await starteDiagnose('A3');
    expect(koerper).toContain('A3');
  });

  it('benutzt POST — ein GET würde ungefragt nach draußen rufen', async () => {
    // Browser holen GETs vor, Dienste prüfen damit die Erreichbarkeit. Das
    // darf hier nicht passieren.
    let methode = '';
    globalThis.fetch = (async (_u: unknown, init?: { method?: string }) => {
      methode = init?.method ?? 'GET';
      return { ok: true, status: 200, json: async () => ({ data: { urteil: '', zeilen: [] } }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await starteDiagnose();
    expect(methode).toBe('POST');
  });
});

describe('fetchOnlineStatus', () => {
  it('liefert den Status durch', async () => {
    antwortet(200, { data: { aktiv: true, hinweis: 'an', dienste: [] } });
    expect((await fetchOnlineStatus())?.aktiv).toBe(true);
  });

  it('gibt `null` statt zu werfen, wenn der Kern schweigt', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchOnlineStatus()).toBeNull();
  });

  it('gibt `null` bei einem Fehlerstatus', async () => {
    antwortet(500, {});
    expect(await fetchOnlineStatus()).toBeNull();
  });
});
