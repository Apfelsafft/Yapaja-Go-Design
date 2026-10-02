import { describe, expect, it, vi } from 'vitest';
import type { NavState, Route } from '@yapaia/shared';
import { Sprachdialog, dauerText, entfernungText, type SprachDeps, type Treffer } from './dialog.js';

const MAGDEBURG: Treffer = { name: 'Ziolkowskistraße', beschreibung: 'Ziolkowskistraße, Magdeburg', lat: 52.16, lon: 11.63 };
const ROUTE = { id: 'r1', distance_m: 401_000, duration_s: 4 * 3600 + 20 * 60 } as unknown as Route;

function deps(status: NavState['status'] = 'idle', extra: Partial<SprachDeps> = {}): SprachDeps & { starte: ReturnType<typeof vi.fn> } {
  const starte = vi.fn();
  return {
    suche: vi.fn(async () => [MAGDEBURG]),
    route: vi.fn(async () => ROUTE),
    starte,
    navigation: () =>
      ({
        status,
        eta: '2026-10-02T15:29:00Z',
        distance_remaining_m: 515_100,
        duration_remaining_s: 6 * 3600 + 4 * 60,
      }) as unknown as NavState,
    pause: vi.fn(),
    weiter: vi.fn(),
    stopp: vi.fn(),
    naechste: () => [
      { name: 'Aral', beschreibung: 'Aral, Ziolkowskistraße 14', lat: 52.1, lon: 11.6, entfernung_m: 2300 },
      { name: 'Shell', beschreibung: 'Shell, Hauptstraße', lat: 52.2, lon: 11.7, entfernung_m: 5100 },
    ],
    verkehr: async () => ({
      meldungen: [
        { titel: 'A5 | Walldorf - Wiesloch', beschreibung: 'Fahrbahnverengung\nbis Ende Oktober', voraus_m: 12_000 },
        { titel: 'A6 | Sperrung', beschreibung: 'Vollsperrung', voraus_m: 3_000 },
        { titel: 'hinter uns', beschreibung: '', voraus_m: -5_000 },
      ],
    }),
    uhrzeit: () => '17:29',
    jetzt: () => 0,
    ...extra,
  } as SprachDeps & { starte: ReturnType<typeof vi.fn> };
}

describe('Sprachdialog', () => {
  it('Ziel: sucht, rechnet die Route, fragt -- und startet erst nach „ja"', async () => {
    const d = deps();
    const s = new Sprachdialog(d);
    const a = await s.verarbeite('Bitte fahre mich zur Ziolkowski Straße nach Magdeburg');
    expect(d.suche).toHaveBeenCalledWith('ziolkowski straße magdeburg');
    expect(a.antwort).toBe('Ziolkowskistraße, Magdeburg: 401 Kilometer, etwa 4 Stunden 20 Minuten. Soll ich losfahren?');
    expect(a.rueckfrage).toBe(true);
    expect(a.aktion?.art).toBe('route_vorschlag');
    expect(d.starte).not.toHaveBeenCalled();

    const b = await s.verarbeite('ja');
    expect(d.starte).toHaveBeenCalledWith(ROUTE, MAGDEBURG);
    expect(b.aktion?.art).toBe('navigation_gestartet');
    // Ein zweites „ja" startet nichts mehr.
    expect((await s.verarbeite('ja')).antwort).toMatch(/nichts zu bestätigen/);
  });

  it('„nein" verwirft den Vorschlag', async () => {
    const d = deps();
    const s = new Sprachdialog(d);
    await s.verarbeite('navigiere nach Magdeburg');
    await s.verarbeite('nein');
    await s.verarbeite('ja');
    expect(d.starte).not.toHaveBeenCalled();
  });

  it('eine Rückfrage verfällt nach zwei Minuten', async () => {
    let t = 0;
    const d = deps('idle', { jetzt: () => t });
    const s = new Sprachdialog(d);
    await s.verarbeite('navigiere nach Magdeburg');
    t = 3 * 60_000;
    await s.verarbeite('ja');
    expect(d.starte).not.toHaveBeenCalled();
  });

  it('nächste Tankstelle, dann „die zweite", dann „los"', async () => {
    const d = deps('navigating');
    const s = new Sprachdialog(d);
    const a = await s.verarbeite('wo ist die nächste Tankstelle?');
    expect(a.antwort).toMatch(/^Nächste Tankstelle: Aral, Ziolkowskistraße 14, in 2,3 Kilometer\. Soll ich dich hinführen\?/);
    const b = await s.verarbeite('die zweite');
    expect(d.route).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shell' }));
    expect(b.antwort).toMatch(/laufende Navigation dorthin ändern/);
    await s.verarbeite('los');
    expect(d.starte).toHaveBeenCalledTimes(1);
  });

  it('Stopp nur, wenn etwas läuft', async () => {
    const d = deps('navigating');
    expect((await new Sprachdialog(d).verarbeite('stoppe navigation')).antwort).toBe('Navigation beendet.');
    expect(d.stopp).toHaveBeenCalled();
    const leer = deps('idle');
    expect((await new Sprachdialog(leer).verarbeite('stoppe navigation')).antwort).toMatch(/keine Navigation/);
    expect(leer.stopp).not.toHaveBeenCalled();
  });

  it('Verkehr: die nächste voraus zuerst, Vergangenes nicht', async () => {
    const s = new Sprachdialog(deps('navigating'));
    expect((await s.verarbeite('lies mir die nächste verkehrsinfo vor')).antwort).toBe(
      'In 3,0 Kilometer: A6 | Sperrung. Vollsperrung.',
    );
    const zwei = await s.verarbeite('lies mir alle baustellen vor');
    expect(zwei.antwort).toContain('In 12 Kilometer: A5 | Walldorf - Wiesloch. Fahrbahnverengung.');
    expect(zwei.antwort).not.toContain('hinter uns');
  });

  it('Ankunft', async () => {
    expect((await new Sprachdialog(deps('navigating')).verarbeite('wann sind wir da')).antwort).toBe(
      'Ankunft um 17:29 in 6 Stunden 4 Minuten, noch 515 Kilometer.',
    );
  });

  it('Suche ohne Treffer und Route ohne Erfolg werden ehrlich gesagt', async () => {
    const ohne = new Sprachdialog(deps('idle', { suche: async () => [] }));
    expect((await ohne.verarbeite('fahre nach Atlantis')).antwort).toBe('Zu „atlantis" habe ich nichts gefunden.');
    const kaputt = new Sprachdialog(
      deps('idle', {
        route: async () => {
          throw new Error('Keine Karte für dieses Gebiet');
        },
      }),
    );
    expect((await kaputt.verarbeite('fahre nach Magdeburg')).antwort).toMatch(/keine Route berechnen \(Keine Karte/);
  });

  it('Texte', () => {
    expect(entfernungText(430)).toBe('450 Meter');
    expect(entfernungText(2_340)).toBe('2,3 Kilometer');
    expect(dauerText(65 * 60)).toBe('eine Stunde 5 Minuten');
  });

  it('ohne Regel-Treffer fragt der Dialog die KI -- und bleibt bei ihrer Absicht', async () => {
    const ki = vi.fn(async () => ({ art: 'naechste' as const, kategorie: 'caravan_site' }));
    const s = new Sprachdialog(deps('idle', { ki }));
    const a = await s.verarbeite('wo können wir heute Nacht pennen');
    expect(ki).toHaveBeenCalledWith('wo können wir heute Nacht pennen');
    expect(a.absicht).toBe('naechste');
    // Was die Regeln verstehen, geht NICHT an die KI.
    ki.mockClear();
    await s.verarbeite('stoppe navigation');
    expect(ki).not.toHaveBeenCalled();
  });
});
