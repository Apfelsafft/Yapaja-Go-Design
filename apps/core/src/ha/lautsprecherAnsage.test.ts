import { describe, expect, it, vi } from 'vitest';
import {
  AnsageKette,
  LautsprecherAnsage,
  findeStimme,
  lautsprecherWahl,
  maLautsprecher,
  type LautsprecherAnsageDeps,
} from './lautsprecherAnsage.js';
import type { HaEntityState } from './client.js';
import type { WebSocketAehnlich } from './commandHelpers.js';

const V = { apiBase: 'http://ha/api', token: 't' };
const ma = (id: string, name: string, state = 'idle'): HaEntityState => ({
  entity_id: id,
  state,
  attributes: { friendly_name: name, mass_player_type: 'player' },
});
const andere: HaEntityState = { entity_id: 'media_player.tv', state: 'idle', attributes: { friendly_name: 'TV' } };

describe('Music-Assistant-Lautsprecher', () => {
  it('erkennt Music-Assistant-Player, ohne nicht erreichbare', () => {
    expect(maLautsprecher([andere, ma('media_player.ma_kueche', 'Küche'), ma('media_player.ma_weg', 'Weg', 'unavailable')])).toEqual([
      { id: 'media_player.ma_kueche', name: 'Küche' },
    ]);
  });

  it('Wahl: eingestellt gilt immer; automatisch nur ohne Beat und bei genau einem Player', () => {
    const einer = [ma('media_player.ma_bus', 'Bus')];
    expect(lautsprecherWahl('media_player.x', [], true)).toBe('media_player.x');
    expect(lautsprecherWahl('', einer, false)).toBe('media_player.ma_bus');
    expect(lautsprecherWahl('', einer, true)).toBeNull(); // Beat übernimmt (Stufe 2/4)
    expect(lautsprecherWahl('', [...einer, ma('media_player.ma_2', 'Zwei')], false)).toBeNull();
    expect(lautsprecherWahl(null, [], false)).toBeNull();
  });
});

describe('findeStimme', () => {
  function ws(antwort: unknown) {
    const gesendet: string[] = [];
    const erzeugeSocket = (): WebSocketAehnlich => {
      const hoerer: Record<string, Array<(e: { data: unknown }) => void>> = {};
      const sock: WebSocketAehnlich = {
        send: (d: string) => {
          gesendet.push(d);
          const n = JSON.parse(d) as { type: string };
          const raus = n.type === 'auth' ? { type: 'auth_ok' } : { type: 'result', id: 1, success: true, result: antwort };
          void Promise.resolve().then(() => hoerer.message?.forEach((h) => h({ data: JSON.stringify(raus) })));
        },
        close: () => undefined,
        addEventListener: ((typ: string, h: (e: { data: unknown }) => void) => {
          (hoerer[typ] ??= []).push(h);
          if (typ === 'message') void Promise.resolve().then(() => h({ data: JSON.stringify({ type: 'auth_required' }) }));
        }) as WebSocketAehnlich['addEventListener'],
      };
      return sock;
    };
    return { erzeugeSocket, gesendet };
  }
  const fetchDe = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ language: 'de' }) }));

  it('fragt Home Assistant nach Stimme und genauer Schreibweise der Sprache', async () => {
    const w = ws({ providers: [{ engine_id: 'tts.home_assistant_cloud', supported_languages: ['de-DE', 'de-CH'] }] });
    const s = await findeStimme(V, {}, { fetch: fetchDe, ws: { erzeugeSocket: w.erzeugeSocket } });
    expect(s).toEqual({ engine: 'tts.home_assistant_cloud', language: 'de-DE' });
    expect(JSON.parse(w.gesendet[1]!)).toMatchObject({ type: 'tts/engine/list', language: 'de' });
  });

  it('eine eingestellte Stimme wird bevorzugt; Stimme und Sprache eingestellt -> keine Anfrage', async () => {
    const w = ws({
      providers: [
        { engine_id: 'tts.a', supported_languages: ['de'] },
        { engine_id: 'tts.piper', supported_languages: ['de_DE'] },
      ],
    });
    expect(await findeStimme(V, { engine: 'tts.piper' }, { fetch: fetchDe, ws: { erzeugeSocket: w.erzeugeSocket } })).toEqual({
      engine: 'tts.piper',
      language: 'de_DE',
    });
    expect(await findeStimme(V, { engine: 'tts.x', language: 'de-DE' })).toEqual({ engine: 'tts.x', language: 'de-DE' });
  });
});

describe('LautsprecherAnsage + Kette', () => {
  function aufbau(ziel: string | null, ok = true) {
    const rufe = vi.fn(async (_v: unknown, _d: Record<string, unknown>) => ({ ok }));
    const deps: LautsprecherAnsageDeps = {
      verbindung: () => V,
      ziel: async () => ziel,
      stimme: async () => ({ engine: 'tts.cloud', language: 'de-DE' }),
      rufe,
    };
    const beat = { sage: vi.fn(async () => true), pruefe: vi.fn(async () => ({ ok: true, grund: 'Beat' })) };
    return { kette: new AnsageKette(new LautsprecherAnsage(deps), beat), rufe, beat };
  }

  it('Stufe 3: an den Music-Assistant-Player, Beat bleibt außen vor', async () => {
    const { kette, rufe, beat } = aufbau('media_player.ma_bus');
    expect(await kette.sage('Jetzt links', 'navigation')).toBe(true);
    expect(rufe).toHaveBeenCalledWith(V, {
      entity_id: 'tts.cloud',
      media_player_entity_id: 'media_player.ma_bus',
      message: 'Jetzt links',
      language: 'de-DE',
    });
    expect(beat.sage).not.toHaveBeenCalled();
    expect((await kette.pruefe()).grund).toMatch(/ma_bus/);
  });

  it('kein Lautsprecher gewählt: Beat (Stufe 2/4); scheitert der Lautsprecher, ebenfalls Beat', async () => {
    const ohne = aufbau(null);
    expect(await ohne.kette.sage('x', 'hinweis')).toBe(true);
    expect(ohne.beat.sage).toHaveBeenCalled();
    expect((await ohne.kette.pruefe()).grund).toBe('Beat');
    const kaputt = aufbau('media_player.ma_bus', false);
    expect(await kaputt.kette.sage('x', 'hinweis')).toBe(true);
    expect(kaputt.beat.sage).toHaveBeenCalled();
  });
});
