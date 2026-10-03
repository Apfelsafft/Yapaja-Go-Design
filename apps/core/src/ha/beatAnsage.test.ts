import { describe, expect, it, vi } from 'vitest';
import { BEAT_ENTITAET, BeatAnsage, beatAktionVorhanden, beatAnsagenAn, rufeBeat, type BeatAnsageDeps } from './beatAnsage.js';

const V = { apiBase: 'http://ha/api', token: 't' };

function ziel(zustand: string | undefined, extra: Partial<BeatAnsageDeps> = {}) {
  const rufe = vi.fn(async (_v: unknown, _d: Record<string, unknown>) => ({ ok: true }));
  const z = new BeatAnsage({
    verbindung: () => V,
    eingeschaltet: () => true,
    stimme: () => ({ engine: 'tts.piper', language: 'de-DE' }),
    leseZustaende: async (_v, ids) => new Map(zustand ? ids.map((id) => [id, zustand]) : []),
    rufe,
    ...extra,
  });
  return { z, rufe };
}

describe('BeatAnsage', () => {
  it('läuft das Radio: Beat mischt die Ansage ein', async () => {
    const { z, rufe } = ziel('playing');
    expect(await z.sage('In 300 Metern rechts', 'navigation')).toBe(true);
    expect(rufe).toHaveBeenCalledWith(V, {
      message: 'In 300 Metern rechts',
      priority: 'navigation',
      engine: 'tts.piper',
      language: 'de-DE',
    });
  });

  it('Radio aus, kein Beat, abgeschaltet oder Fehler: Go spricht selbst', async () => {
    for (const { z, rufe } of [
      ziel('idle'),
      ziel(undefined),
      ziel('playing', { eingeschaltet: () => false }),
    ]) {
      expect(await z.sage('Hallo', 'hinweis')).toBe(false);
      expect(rufe).not.toHaveBeenCalled();
    }
    const fehler = ziel('playing', { rufe: async () => ({ ok: false, status: 500 }) });
    expect(await fehler.z.sage('Hallo', 'hinweis')).toBe(false);
    const wirft = ziel('playing', {
      leseZustaende: async () => {
        throw new Error('weg');
      },
    });
    expect(await wirft.z.sage('Hallo', 'hinweis')).toBe(false);
  });

  it('der Test sagt in Klartext, woran es liegt', async () => {
    expect((await ziel(undefined).z.pruefe()).grund).toMatch(/nicht eingerichtet/);
    expect((await ziel('idle').z.pruefe()).grund).toMatch(/spielt gerade nicht/);
    expect((await ziel('playing', { aktionVorhanden: async () => false }).z.pruefe()).grund).toMatch(
      /neu starten/,
    );
    expect((await ziel('playing', { rufe: async () => ({ ok: false, status: 500 }) }).z.pruefe()).grund).toMatch(
      /Sprachausgabe \(TTS\)/,
    );
    const gut = await ziel('playing', { aktionVorhanden: async () => true }).z.pruefe();
    expect(gut).toEqual({ ok: true, grund: 'Yapaia Beat hat die Ansage ins Radio gemischt.' });
  });

  it('rufeBeat und beatAktionVorhanden sprechen mit der REST-Schnittstelle', async () => {
    const aufrufe: string[] = [];
    const fetch = vi.fn(async (url: string, init: { method: string }) => {
      aufrufe.push(`${init.method} ${url}`);
      return url.endsWith('/services')
        ? { ok: true, status: 200, json: async () => [{ domain: 'yapaia_beat', services: { announce: {}, play: {} } }] }
        : { ok: false, status: 500 };
    });
    expect(await beatAktionVorhanden(V, { fetch })).toBe(true);
    expect(await rufeBeat(V, { message: 'x' }, { fetch })).toEqual({ ok: false, status: 500 });
    expect(aufrufe).toEqual(['GET http://ha/api/services', 'POST http://ha/api/services/yapaia_beat/announce']);
  });

  it('Einstellung: fehlt = an', () => {
    expect(beatAnsagenAn(undefined)).toBe(true);
    expect(beatAnsagenAn(null)).toBe(true);
    expect(beatAnsagenAn(false)).toBe(false);
    expect(BEAT_ENTITAET).toBe('media_player.yapaia_beat');
  });
});
