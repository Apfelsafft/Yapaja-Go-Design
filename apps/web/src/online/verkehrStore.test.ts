/**
 * Der Zustand der Verkehrslage.
 *
 * ─── DIE ENTSCHEIDUNG, UM DIE ES HIER GEHT ──────────────────────────────────
 * Ein fehlgeschlagener Abruf nimmt KEINE Baustelle von der Karte.
 *
 * Wer auf der A61 unterwegs ist und kurz kein Netz hat, soll die Baustelle
 * weiter sehen, die vor fünf Minuten noch da war. Sie steht ja immer noch
 * dort — es ist nur gerade niemand erreichbar, der das bestätigen könnte.
 *
 * Die Gegenrichtung wäre schlimmer: Meldungen verschwinden zu lassen, sobald
 * das Netz wackelt, hiesse eine leere Karte zu zeigen, die aussieht wie
 * „freie Fahrt".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useVerkehrStore } from './verkehrStore';
import type { KartenMeldung } from './verkehrGeoJson';

const echt = globalThis.fetch;

function meldung(id: string): KartenMeldung {
  return {
    id,
    art: 'baustelle',
    strasse: 'A61',
    titel: 'Fahrbahnverengung',
    beschreibung: '',
    lat: 49.9,
    lon: 7.8,
    symbol: 'verkehr-baustelle',
  };
}

function antwortet(daten: unknown, ok = true, status = 200): void {
  globalThis.fetch = (async () =>
    ({ ok, status, json: async () => daten }) as unknown as Response) as unknown as typeof fetch;
}

beforeEach(() => {
  useVerkehrStore.getState().leeren();
});
afterEach(() => {
  globalThis.fetch = echt;
});

describe('verkehrStore — der gute Fall', () => {
  it('übernimmt Meldungen, Straßenbefunde und Urteil', async () => {
    antwortet({
      data: {
        meldungen: [meldung('a')],
        strassen: [{ strasse: 'A61', quelle: 'frisch', meldungen: 1 }],
        ohne_ort: 2,
        urteil: '1 Meldung(en) auf der Strecke.',
      },
    });
    await useVerkehrStore.getState().abrufen(['A61']);

    const s = useVerkehrStore.getState();
    expect(s.meldungen).toHaveLength(1);
    expect(s.strassen[0].strasse).toBe('A61');
    expect(s.ohneOrt).toBe(2);
    expect(s.fehler).toBeNull();
    expect(s.standVon).not.toBeNull();
  });

  it('merkt sich, WANN der Stand ist', async () => {
    // Ohne den Zeitstempel könnte die Oberfläche nicht sagen, wie alt das
    // ist, was sie zeigt — und alte Daten als frische auszugeben ist in
    // diesem Projekt die teuerste Sorte Aussage.
    const vorher = Date.now();
    antwortet({ data: { meldungen: [], strassen: [], ohne_ort: 0, urteil: '' } });
    await useVerkehrStore.getState().abrufen(['A61']);
    expect(useVerkehrStore.getState().standVon).toBeGreaterThanOrEqual(vorher);
  });
});

describe('verkehrStore — wenn der Abruf scheitert', () => {
  it('BEHÄLT die vorherigen Meldungen', async () => {
    antwortet({ data: { meldungen: [meldung('a')], strassen: [], ohne_ort: 0, urteil: 'ok' } });
    await useVerkehrStore.getState().abrufen(['A61']);
    expect(useVerkehrStore.getState().meldungen).toHaveLength(1);

    globalThis.fetch = (async () => {
      throw new Error('kein Netz');
    }) as unknown as typeof fetch;
    await useVerkehrStore.getState().abrufen(['A61']);

    const s = useVerkehrStore.getState();
    expect(s.meldungen, 'die Baustelle steht ja immer noch dort').toHaveLength(1);
    expect(s.fehler).toContain('kein Netz');
  });

  it('und merkt den Zeitstempel NICHT neu', async () => {
    // Sonst sähe der alte Stand aus wie ein frischer — genau das, was der
    // Zeitstempel verhindern soll.
    antwortet({ data: { meldungen: [meldung('a')], strassen: [], ohne_ort: 0, urteil: '' } });
    await useVerkehrStore.getState().abrufen(['A61']);
    const stand = useVerkehrStore.getState().standVon;

    globalThis.fetch = (async () => {
      throw new Error('weg');
    }) as unknown as typeof fetch;
    await useVerkehrStore.getState().abrufen(['A61']);

    expect(useVerkehrStore.getState().standVon).toBe(stand);
  });

  it('wirft nie — ein Fehler ist eine Auskunft', async () => {
    globalThis.fetch = (async () => {
      throw new Error('kaputt');
    }) as unknown as typeof fetch;
    await expect(useVerkehrStore.getState().abrufen(['A61'])).resolves.toBeUndefined();
    expect(useVerkehrStore.getState().laeuft).toBe(false);
  });

  it('räumt `laeuft` auch im Fehlerfall wieder ab', async () => {
    // Bliebe es stehen, käme nie wieder ein Abruf zustande — die Sperre
    // unten würde jeden weiteren abweisen, und die Karte fröre für immer
    // auf dem alten Stand ein.
    globalThis.fetch = (async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    await useVerkehrStore.getState().abrufen(['A61']);
    expect(useVerkehrStore.getState().laeuft).toBe(false);

    antwortet({ data: { meldungen: [meldung('b')], strassen: [], ohne_ort: 0, urteil: '' } });
    await useVerkehrStore.getState().abrufen(['A61']);
    expect(useVerkehrStore.getState().meldungen[0].id).toBe('b');
  });

  it('behält die Meldung des Kerns bei 409', async () => {
    // Sie sagt bereits, wo der Schalter sitzt.
    antwortet(
      { error: { code: 'ONLINE_DISABLED', message: 'Die Online-Dienste sind ausgeschaltet. …enabled' } },
      false,
      409,
    );
    await useVerkehrStore.getState().abrufen(['A61']);
    expect(useVerkehrStore.getState().fehler).toContain('enabled');
  });
});

describe('verkehrStore — keine Salve nach draußen', () => {
  it('ein zweiter Abruf wird abgewiesen, solange einer läuft', async () => {
    // Die Route ändert sich im Sekundentakt. Ohne diese Sperre stünden
    // mehrere Anfragen gleichzeitig an derselben offenen Schnittstelle, und
    // die LETZTE Antwort gewänne — nicht die neueste Anfrage.
    let rufe = 0;
    globalThis.fetch = (async () => {
      rufe += 1;
      await new Promise((r) => setTimeout(r, 10));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { meldungen: [], strassen: [], ohne_ort: 0, urteil: '' } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const erster = useVerkehrStore.getState().abrufen(['A61']);
    await useVerkehrStore.getState().abrufen(['A61']);
    await erster;
    expect(rufe).toBe(1);
  });

  it('ohne Autobahnen wird gar nicht gerufen', async () => {
    const spion = vi.fn();
    globalThis.fetch = spion as unknown as typeof fetch;
    await useVerkehrStore.getState().abrufen([]);
    expect(spion).not.toHaveBeenCalled();
  });
});
