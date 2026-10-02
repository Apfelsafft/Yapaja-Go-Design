import { describe, expect, it, vi } from 'vitest';
import { AnsagePause, RADIO_ENTITAET, ansagePauseEntitaet, sprechdauerMs, type AnsagePauseDeps } from './ansagePause.js';

const V = { apiBase: 'http://ha/api', token: 't' };

function aufbau(zustand: string | undefined, entitaet: string | null = RADIO_ENTITAET) {
  const timer: Array<{ fn: () => void; ms: number }> = [];
  const dienst = vi.fn(async (_v: unknown, _d: string, _id: string) => true);
  const deps: AnsagePauseDeps = {
    verbindung: () => V,
    entitaet: () => entitaet,
    leseZustaende: async (_v, ids) => new Map(zustand ? ids.map((id) => [id, zustand]) : []),
    dienst,
    warte: async () => undefined,
    setTimeoutImpl: (fn, ms) => {
      timer.push({ fn, ms });
      return timer.length;
    },
    clearTimeoutImpl: (h) => {
      const t = timer[(h as number) - 1];
      if (t) t.fn = () => undefined;
    },
  };
  const ablaufen = async () => {
    for (const t of timer.splice(0)) t.fn();
    await Promise.resolve();
  };
  return { pause: new AnsagePause(deps), dienst, timer, ablaufen };
}

describe('AnsagePause', () => {
  it('läuft das Radio: anhalten, nach der Ansage weiter', async () => {
    const { pause, dienst, timer, ablaufen } = aufbau('playing');
    await pause.beginne();
    expect(dienst).toHaveBeenCalledWith(V, 'media_pause', RADIO_ENTITAET);
    pause.ende(4000);
    expect(timer[0]?.ms).toBe(4000);
    expect(dienst).toHaveBeenCalledTimes(1);
    await ablaufen();
    expect(dienst).toHaveBeenLastCalledWith(V, 'media_play', RADIO_ENTITAET);
  });

  it('war das Radio aus, bleibt es aus', async () => {
    const { pause, dienst, ablaufen } = aufbau('idle');
    await pause.beginne();
    pause.ende(1000);
    await ablaufen();
    expect(dienst).not.toHaveBeenCalled();
  });

  it('ohne Yapaia Beat oder abgeschaltet: nichts', async () => {
    for (const a of [aufbau(undefined), aufbau('playing', null)]) {
      await a.pause.beginne();
      a.pause.ende(0);
      await a.ablaufen();
      expect(a.dienst).not.toHaveBeenCalled();
    }
  });

  it('zwei Ansagen kurz nacheinander teilen sich eine Pause', async () => {
    const { pause, dienst, ablaufen } = aufbau('playing');
    await pause.beginne();
    pause.ende(3000);
    await pause.beginne(); // kommt, bevor die erste fertig ist
    pause.ende(3000);
    await ablaufen();
    expect(dienst.mock.calls.map((c) => c[1])).toEqual(['media_pause', 'media_play']);
  });

  it('Einstellung und Sprechdauer', () => {
    expect(ansagePauseEntitaet(undefined)).toBe(RADIO_ENTITAET);
    expect(ansagePauseEntitaet('')).toBeNull();
    expect(ansagePauseEntitaet('aus')).toBeNull();
    expect(ansagePauseEntitaet('media_player.kueche')).toBe('media_player.kueche');
    expect(ansagePauseEntitaet('switch.radio')).toBeNull();
    expect(sprechdauerMs('In 300 Metern rechts abbiegen.')).toBeGreaterThan(2_000);
    expect(sprechdauerMs('x'.repeat(5000))).toBe(30_000);
  });
});
