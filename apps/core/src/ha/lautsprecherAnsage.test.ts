import { describe, expect, it, vi } from 'vitest';
import {
  AnsageKette,
  LautsprecherAnsage,
  ansageWeg,
  ansageZiel,
  beatSpieltAuf,
  findeStimme,
  ttsMedienId,
  lautsprecherWahl,
  maEingerichtet,
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

describe('ansageWeg -- was die Einstellungen anzeigen', () => {
  const beat = (state: string, speaker: string | null): HaEntityState => ({
    entity_id: 'media_player.yapaia_beat',
    state,
    attributes: { friendly_name: 'Yapaia Beat', speaker },
  });
  const bus = ma('media_player.ma_bus', 'Bus');

  it('gewählter Player geht vor', () => {
    expect(ansageWeg('media_player.ma_bus', [bus, beat('playing', null)], true)).toEqual({ art: 'lautsprecher', ziel: 'Bus' });
  });
  it('Beat spielt auf dem gewählten Player: Beat mischt (kein Anhalten durch Music Assistant)', () => {
    expect(ansageWeg('media_player.ma_bus', [bus, beat('playing', 'media_player.ma_bus')], true)).toEqual({
      art: 'beat-ma',
      ziel: 'Bus',
    });
    expect(beatSpieltAuf([bus, beat('playing', 'media_player.ma_bus')], 'media_player.ma_bus')).toBe(true);
    expect(beatSpieltAuf([bus, beat('idle', 'media_player.ma_bus')], 'media_player.ma_bus')).toBe(false);
  });
  it('ansageZiel: spielt Beat auf dem gewählten Player, mischt Beat (kein Ziel für Go)', () => {
    // genau der Fall aus dem Test mit 0.37.4: Ansicht sagte "Beat mischt",
    // die Ansage ging trotzdem an Music Assistant
    const ipad = ma('media_player.yapaia_ipad', 'Yapaia iPad');
    expect(ansageZiel('media_player.yapaia_ipad', [ipad, beat('playing', 'media_player.yapaia_ipad')], true)).toBeNull();
    expect(ansageZiel('media_player.yapaia_ipad', [ipad, beat('idle', 'media_player.yapaia_ipad')], true)).toBe(
      'media_player.yapaia_ipad',
    );
    expect(ansageZiel('media_player.yapaia_ipad', [ipad, beat('playing', 'media_player.yapaia_ipad')], false)).toBe(
      'media_player.yapaia_ipad',
    );
    // ohne Attribute (nur Zustände) erkennt man es nicht -- darum braucht ziel() die vollen Zustände
    expect(
      ansageZiel('media_player.yapaia_ipad', [ipad, { entity_id: 'media_player.yapaia_beat', state: 'playing', attributes: {} }], true),
    ).toBe('media_player.yapaia_ipad');
  });
  it('Beat auf einem Music-Assistant-Player: Stufe 4', () => {
    expect(ansageWeg('', [bus, beat('playing', 'media_player.ma_bus')], true)).toEqual({ art: 'beat-ma', ziel: 'Bus' });
  });
  it('Beat auf einem anderen Weg mischt selbst; ohne Radio spricht Go', () => {
    expect(ansageWeg('', [andere, beat('playing', 'media_player.tv')], true)).toEqual({ art: 'beat', radioLaeuft: true });
    expect(ansageWeg('', [bus, beat('idle', 'media_player.ma_bus')], true)).toEqual({ art: 'beat', radioLaeuft: false });
  });
  it('ohne Beat und mit genau einem Player: Stufe 3; sonst Go selbst', () => {
    expect(ansageWeg('', [bus], true)).toEqual({ art: 'lautsprecher', ziel: 'Bus' });
    expect(ansageWeg('', [andere], true)).toEqual({ art: 'selbst' });
    expect(ansageWeg('', [beat('playing', null)], false)).toEqual({ art: 'selbst' });
  });
});

describe('ttsMedienId', () => {
  it('baut die Medienquelle wie tts.speak (auch für alte Plattform-Namen)', () => {
    expect(ttsMedienId('google_translate', 'Jetzt rechts & dann links', 'de')).toBe(
      'media-source://tts/google_translate?message=Jetzt+rechts+%26+dann+links&language=de',
    );
    expect(ttsMedienId('tts.piper', 'Hallo')).toBe('media-source://tts/tts.piper?message=Hallo');
  });
});

describe('maEingerichtet', () => {
  const antwort = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' }));
  it('liest die Komponenten von Home Assistant', async () => {
    expect(await maEingerichtet(V, antwort({ components: ['tts', 'music_assistant'] }) as never)).toBe(true);
    expect(await maEingerichtet(V, antwort({ components: ['tts'] }) as never)).toBe(false);
    expect(await maEingerichtet(V, antwort({}, false) as never)).toBeNull();
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

  it('auch eine eingestellte Sprache wird in die Schreibweise der Stimme gebracht ("de" -> "de-DE")', async () => {
    const w = ws({ providers: [{ engine_id: 'tts.home_assistant_cloud', supported_languages: ['de-DE'] }] });
    expect(
      await findeStimme(V, { engine: 'tts.home_assistant_cloud', language: 'de' }, { ws: { erzeugeSocket: w.erzeugeSocket } }),
    ).toEqual({ engine: 'tts.home_assistant_cloud', language: 'de-DE' });
    expect(JSON.parse(w.gesendet[1]!)).toMatchObject({ type: 'tts/engine/list', language: 'de' });
  });

  it('kennt die Liste die gewählte Stimme nicht, bleibt es bei der Einstellung', async () => {
    const w = ws({ providers: [{ engine_id: 'tts.andere', supported_languages: ['de'] }] });
    expect(await findeStimme(V, { engine: 'tts.x', language: 'de-DE' }, { ws: { erzeugeSocket: w.erzeugeSocket } })).toEqual({
      engine: 'tts.x',
      language: 'de-DE',
    });
  });

  it('eine Stimme beim Plattform-Namen ("google_translate") wird zur Entität', async () => {
    const w = ws({
      providers: [
        { engine_id: 'google_translate', supported_languages: ['de'] },
        { engine_id: 'tts.piper', supported_languages: ['de_DE'] },
        { engine_id: 'tts.google_translate_en_com', supported_languages: ['de'] },
      ],
    });
    expect(
      await findeStimme(V, { engine: 'google_translate', language: 'de' }, { ws: { erzeugeSocket: w.erzeugeSocket } }),
    ).toEqual({ engine: 'tts.google_translate_en_com', language: 'de' });
  });

  it('ohne jede Entität bleibt der Plattform-Name (die Medienquelle kennt ihn)', async () => {
    const w = ws({ providers: [{ engine_id: 'google_translate', supported_languages: ['de'] }] });
    expect(
      await findeStimme(V, { engine: 'google_translate', language: 'de' }, { ws: { erzeugeSocket: w.erzeugeSocket } }),
    ).toEqual({ engine: 'google_translate', language: 'de' });
  });

  it('eine eingestellte Stimme wird bevorzugt', async () => {
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
      entity_id: 'media_player.ma_bus',
      media_content_id: 'media-source://tts/tts.cloud?message=Jetzt+links&language=de-DE',
      media_content_type: 'music',
      announce: true,
      extra: { use_pre_announce: true },
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

  it('ohne Gong: use_pre_announce false', async () => {
    const rufe = vi.fn(async (_v: unknown, _d: Record<string, unknown>) => ({ ok: true }));
    await new LautsprecherAnsage({
      verbindung: () => V,
      ziel: async () => 'media_player.x',
      stimme: async () => ({ engine: 'tts.cloud' }),
      rufe,
      gong: () => false,
    }).sage('Hallo', 'info');
    expect(rufe.mock.calls[0]![1]).toMatchObject({ extra: { use_pre_announce: false }, announce: true });
  });

  it('nennt den Grund, den Home Assistant angibt', async () => {
    const deps: LautsprecherAnsageDeps = {
      verbindung: () => V,
      ziel: async () => 'media_player.yapaia_ipad',
      stimme: async () => ({ engine: 'tts.cloud', language: 'de' }),
      rufe: async () => ({ ok: false, fehler: 'Language de not supported' }),
    };
    const r = await new LautsprecherAnsage(deps).pruefe();
    expect(r.ok).toBe(false);
    expect(r.grund).toContain('media_player.yapaia_ipad');
    expect(r.grund).toContain('tts.cloud, de');
    expect(r.grund).toContain('Language de not supported');
  });
});
