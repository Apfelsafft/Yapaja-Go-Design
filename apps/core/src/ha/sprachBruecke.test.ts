import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_ID, HaSprachBruecke, SAETZE, SPRACH_ANTWORT, SPRACH_EINGABE, automationKonfig, leseEingabe } from './sprachBruecke.js';

const V = { apiBase: 'http://supervisor/core/api', token: 't' };

function bruecke(werte: Array<string | undefined>, extra: Record<string, unknown> = {}) {
  let i = 0;
  const geschrieben: Array<{ entityId: string; body: { state: string; attributes?: Record<string, unknown> } }> = [];
  const verarbeite = vi.fn(async (text: string) => ({ antwort: `Antwort auf ${text}`, absicht: 'ziel', rueckfrage: true }));
  const b = new HaSprachBruecke({
    verbindung: () => V,
    leseZustaende: async () => {
      const w = werte[Math.min(i++, werte.length - 1)];
      return new Map(w === undefined ? [] : [[SPRACH_EINGABE, w]]);
    },
    schreibeZustand: async (_v, entityId, body) => {
      geschrieben.push({ entityId, body });
      return true;
    },
    verarbeite,
    ws: { logger: { info: () => {}, warn: () => {} }, erzeugeSocket: () => { throw new Error('kein ws im Test'); } },
    logger: { info: () => {}, warn: () => {} },
    setIntervalImpl: () => 0,
    clearIntervalImpl: () => {},
    ...extra,
  });
  return { b, geschrieben, verarbeite };
}

describe('HaSprachBruecke', () => {
  it('der erste Wert ist Grundlinie, jeder neue Satz wird beantwortet', async () => {
    const { b, geschrieben, verarbeite } = bruecke([
      '100|alter Satz von gestern',
      '100|alter Satz von gestern',
      '200|fahre mich nach Magdeburg',
      '300|ja',
      '400|ja',
    ]);
    await b.takt(); // Grundlinie
    await b.takt(); // unverändert
    expect(verarbeite).not.toHaveBeenCalled();
    await b.takt();
    await b.takt();
    await b.takt(); // zweimal „ja" hintereinander -- dank Zeitstempel zweimal ausgeführt
    expect(verarbeite.mock.calls.map((c) => c[0])).toEqual(['fahre mich nach Magdeburg', 'ja', 'ja']);
    expect(geschrieben).toHaveLength(3);
    expect(geschrieben[0]!.entityId).toBe(SPRACH_ANTWORT);
    expect(geschrieben[0]!.body.attributes).toMatchObject({ antwort: 'Antwort auf fahre mich nach Magdeburg', rueckfrage: true });
    // Jeder Zustand ist neu, damit „wait_for_trigger" in der Automation feuert.
    expect(new Set(geschrieben.map((g) => g.body.state)).size).toBe(3);
  });

  it('das Radio hält an, solange Yapaia antwortet', async () => {
    const ansagePause = { beginne: vi.fn(async () => undefined), ende: vi.fn((_ms?: number) => undefined) };
    const { b, verarbeite } = bruecke(['1|alt', '2|wo ist der nächste Aldi'], { ansagePause });
    await b.takt();
    expect(ansagePause.beginne).not.toHaveBeenCalled();
    await b.takt();
    expect(ansagePause.beginne).toHaveBeenCalledTimes(1);
    expect(verarbeite).toHaveBeenCalledTimes(1);
    // Nachlauf: Sprechdauer plus die Zeit, bis Home Assistant spricht.
    expect(ansagePause.ende.mock.calls[0]?.[0]).toBeGreaterThan(3_000);
  });

  it('leseEingabe', () => {
    expect(leseEingabe('17|Yapaia, stopp')).toEqual({ schluessel: '17|Yapaia, stopp', text: 'Yapaia, stopp' });
    expect(leseEingabe('unknown')).toBeNull();
    expect(leseEingabe('5|  ')).toBeNull();
  });

  it('die Automation hört auf „Yapaia …" und gibt die Antwort an Assist zurück', () => {
    const a = automationKonfig() as { triggers: Array<{ trigger: string; command: string[] }>; actions: Array<Record<string, unknown>> };
    expect(a.triggers[0]!.trigger).toBe('conversation');
    expect(a.triggers[0]!.command).toEqual(SAETZE);
    expect(SAETZE).toContain('Yapaia {befehl}');
    expect(JSON.stringify(a.actions)).toContain(SPRACH_EINGABE);
    expect(JSON.stringify(a.actions)).toContain('set_conversation_response');
  });

  it('einrichten legt die Automation über die Konfigurations-Schnittstelle an', async () => {
    const aufrufe: string[] = [];
    const { b } = bruecke(['1|x'], {
      fetch: async (url: string) => {
        aufrufe.push(url);
        return { ok: true, status: 200 };
      },
    });
    const r = await b.einrichten();
    expect(r).toEqual({ helfer: true, automation: true });
    expect(aufrufe).toEqual([`http://supervisor/core/api/config/automation/config/${AUTOMATION_ID}`]);
  });

  it('einrichten sagt ehrlich, wenn Home Assistant ablehnt', async () => {
    const { b } = bruecke(['1|x'], { fetch: async () => ({ ok: false, status: 403 }) });
    const r = await b.einrichten();
    expect(r.automation).toBe(false);
    expect(r.hinweis).toMatch(/nicht, Automationen anzulegen/);
  });
});
