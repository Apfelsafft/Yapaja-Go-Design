import { describe, expect, it, vi } from 'vitest';
import { BEAT_ENTITAET, BeatAnsage, beatAnsagenAn, type BeatAnsageDeps } from './beatAnsage.js';

const V = { apiBase: 'http://ha/api', token: 't' };

function ziel(zustand: string | undefined, extra: Partial<BeatAnsageDeps> = {}) {
  const rufe = vi.fn(async (_v: unknown, _d: Record<string, unknown>) => true);
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
    const fehler = ziel('playing', { rufe: async () => false });
    expect(await fehler.z.sage('Hallo', 'hinweis')).toBe(false);
    const wirft = ziel('playing', {
      leseZustaende: async () => {
        throw new Error('weg');
      },
    });
    expect(await wirft.z.sage('Hallo', 'hinweis')).toBe(false);
  });

  it('Einstellung: fehlt = an', () => {
    expect(beatAnsagenAn(undefined)).toBe(true);
    expect(beatAnsagenAn(null)).toBe(true);
    expect(beatAnsagenAn(false)).toBe(false);
    expect(BEAT_ENTITAET).toBe('media_player.yapaia_beat');
  });
});
