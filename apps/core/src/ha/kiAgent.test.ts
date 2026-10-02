import { describe, expect, it } from 'vitest';
import { absichtAusText, frageKi, kiAnweisung } from './kiAgent.js';

describe('kiAgent', () => {
  it('liest die Absicht aus der Antwort, auch mit Text drumherum', () => {
    expect(absichtAusText('Klar: {"art":"ziel","ort":"Ziolkowskistraße 8, Magdeburg"}')).toEqual({
      art: 'ziel',
      ort: 'Ziolkowskistraße 8, Magdeburg',
    });
    expect(absichtAusText('{"art":"naechste","kategorie":"fuel"}')).toEqual({ art: 'naechste', kategorie: 'fuel' });
    expect(absichtAusText('{"art":"verkehr","anzahl":9}')).toEqual({ art: 'verkehr', anzahl: 5 });
  });

  it('verwirft Unbekanntes, Erfundenes und Kaputtes', () => {
    expect(absichtAusText('{"art":"unbekannt"}')).toBeNull();
    expect(absichtAusText('{"art":"licht_an"}')).toBeNull();
    expect(absichtAusText('{"art":"naechste","kategorie":"eisdiele"}')).toBeNull();
    expect(absichtAusText('Ich weiß nicht')).toBeNull();
    expect(absichtAusText('{kaputt')).toBeNull();
  });

  it('die Anweisung enthält den Satz und verbietet das Ausführen', () => {
    const a = kiAnweisung('such mir was zum Schlafen');
    expect(a).toContain('Befehl: such mir was zum Schlafen');
    expect(a).toContain('Führe NICHTS aus');
  });

  it('ruft conversation/process mit dem gewählten Agenten', async () => {
    let gerufen: { url: string; body: Record<string, unknown> } | null = null;
    const r = await frageKi({ apiBase: 'http://ha/api', token: 't' }, 'conversation.openai', 'Schlafplatz bitte', {
      fetch: async (url, init) => {
        gerufen = { url, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> };
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: { speech: { plain: { speech: '{"art":"naechste","kategorie":"caravan_site"}' } } } }),
        };
      },
    });
    expect(r).toEqual({ art: 'naechste', kategorie: 'caravan_site' });
    expect(gerufen!.url).toBe('http://ha/api/conversation/process');
    expect(gerufen!.body.agent_id).toBe('conversation.openai');
    expect(gerufen!.body.language).toBe('de');
  });

  it('ein Fehler ist kein Absturz', async () => {
    const r = await frageKi({ apiBase: 'http://ha/api', token: 't' }, 'conversation.x', 'egal', {
      fetch: async () => {
        throw new Error('weg');
      },
    });
    expect(r).toBeNull();
  });
});
