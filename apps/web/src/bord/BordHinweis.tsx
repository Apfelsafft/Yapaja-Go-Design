/**
 * „Grauwasser bei 85 % — Entsorgungsstation in 12 km an der Strecke."
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Idee 4 aus `docs/ideen-ki.md`: das Wohnmobil meldet sich, bevor man am
 * Stellplatz merkt, dass der Tank voll ist -- und bietet die passende Station
 * gleich als nächsten Halt an.
 *
 * ─── WIE LAUT ───────────────────────────────────────────────────────────────
 * Einmal angesagt (wenn die Ansagen an sind) und sichtbar, bis man „Später"
 * oder „Als nächsten Halt" tippt. Danach kommt derselbe Hinweis erst wieder,
 * wenn eine andere Station die nächste ist (`hinweisSchluessel`). Im
 * Fahrtmenü bleibt er nachlesbar.
 */

import React, { useEffect, useRef, useState } from 'react';
import { BORD_ABFRAGE_MS, hinweisSchluessel, stationsZeile, useBordStore, type BordHinweis as Hinweis } from './bordStore.js';
import { useRoutingStore } from '../routing/store.js';
import { useProfileStore } from '../profiles/store.js';
import { useTtsStore } from '../drive/ttsStore.js';
import { announce } from '../drive/tts.js';
import { sageAn } from '../drive/ansageZiel.js';
import { useFahrtAnsicht } from '../drive/useFahrtAnsicht.js';

const SYMBOL: Record<Hinweis['art'], string> = {
  grauwasser: '🚿',
  frischwasser: '💧',
  batterie: '🔋',
  frost: '❄️',
};

/** Den Stopp als nächsten Halt einschieben -- derselbe Weg wie im Fahrtmenü. */
export function stationAlsHalt(h: Hinweis): void {
  if (!h.station) return;
  const profileId = useProfileStore.getState().activeProfile?.id;
  useRoutingStore
    .getState()
    .zwischenstoppVorn({ lat: h.station.lat, lon: h.station.lon }, h.station.name, { origin: 'current', profileId });
}

export default function BordHinweis(): React.ReactElement | null {
  const laden = useBordStore((s) => s.laden);
  const eingerichtet = useBordStore((s) => s.eingerichtet);
  const hinweise = useBordStore((s) => s.hinweise);
  const ttsAn = useTtsStore((s) => s.enabled);
  const fahrt = useFahrtAnsicht();
  const [weg, setWeg] = useState<ReadonlySet<string>>(new Set());
  const angesagt = useRef(new Set<string>());

  // Abfragen: gleich zu Beginn, dann im Takt. Ohne eingerichtete Sensoren
  // nur selten -- es kann ja jemand gerade die Add-on-Konfiguration ändern.
  useEffect(() => {
    void laden();
    const t = setInterval(() => void laden(), eingerichtet ? BORD_ABFRAGE_MS : 5 * BORD_ABFRAGE_MS);
    return () => clearInterval(t);
  }, [laden, eingerichtet]);

  const sichtbar = hinweise.filter((h) => !weg.has(hinweisSchluessel(h)));

  // Einmal ansagen -- nur während der Fahrt und nur mit eingeschalteten
  // Ansagen. Im Stand liest man ihn.
  useEffect(() => {
    if (!fahrt || !ttsAn) return;
    for (const h of sichtbar) {
      const k = hinweisSchluessel(h);
      if (angesagt.current.has(k)) continue;
      angesagt.current.add(k);
      void sageAn(h.station ? `${h.text} ${stationsZeile(h.station)}.` : h.text, 'hinweis', (t) => announce(t));
    }
  }, [sichtbar, fahrt, ttsAn]);

  if (sichtbar.length === 0) return null;
  const wegDamit = (h: Hinweis) => setWeg((alt) => new Set([...alt, hinweisSchluessel(h)]));

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[calc(16rem+var(--kopf-mehr,0px))] z-30 flex w-[min(calc(var(--sicht-b,100vw)*0.92),30rem)] -translate-x-1/2 flex-col gap-2"
      data-testid="bord-hinweise"
    >
      {sichtbar.map((h) => (
        <div
          key={hinweisSchluessel(h)}
          role="status"
          data-testid={`bord-hinweis-${h.art}`}
          className="pointer-events-auto rounded-lg border border-sky-300 bg-sky-50/95 px-3 py-2 text-sm text-sky-950 shadow-lg dark:border-sky-700 dark:bg-sky-950/95 dark:text-sky-50"
        >
          <p className="font-medium">
            <span aria-hidden="true">{SYMBOL[h.art]} </span>
            {h.text}
          </p>
          {h.station && (
            <p className="mt-0.5 text-xs" data-testid={`bord-station-${h.art}`}>
              {stationsZeile(h.station)}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {h.station && (
              <button
                type="button"
                className="min-h-[44px] rounded-md bg-sky-700 px-3 text-white"
                data-testid={`bord-halt-${h.art}`}
                onClick={() => {
                  stationAlsHalt(h);
                  wegDamit(h);
                }}
              >
                Als nächsten Halt
              </button>
            )}
            <button
              type="button"
              className="min-h-[44px] rounded-md px-3 underline"
              data-testid={`bord-spaeter-${h.art}`}
              onClick={() => wegDamit(h)}
            >
              Später
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
