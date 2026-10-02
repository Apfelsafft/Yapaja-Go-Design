/**
 * Die Ortskarte -- Zustand 3 aus `docs/entwurf-ui-umbau.md`.
 *
 * Gewünscht: „Wenn man ein Ziel ausgewählt hat, kann man die Route suchen
 * bzw. dann die Navigation starten. Oder auch nur die Infos (Internet
 * vorausgesetzt) zu dem entsprechend markierten Punkt lesen."
 *
 * Offline steht hier, was die Karte selbst weiß: Name, Kategorie, Adresse,
 * Entfernung. Ist der Online-Teil eingeschaltet, kommen OpenStreetMap-
 * Angaben, ein Wikipedia-Auszug und Bilder dazu (`ortClient.ts`).
 *
 * Sitzt im Seitenpanel unter Suche und Chips (`TopBar`), also auf der
 * Fahrerseite. Während der Fahrt gibt es das Panel nicht -- und damit auch
 * keine Karte, die ablenkt.
 */

import React, { useEffect, useState } from 'react';
import { useOrtStore, type GewaehlterOrt } from './ortStore.js';
import { holeOrtInfo, type OrtErgebnis } from './ortClient.js';
import { useRoutingStore } from '../routing/store.js';
import { useProfileStore } from '../profiles/store.js';
import { useFavoritesStore } from '../favorites/store.js';
import { iconForFavoriteCategory } from '../favorites/icons.js';
import { usePositionStore } from '../position/positionStore.js';
import { haversineMeters } from '../search/distance.js';
import { CHIP_ZEICHEN } from '../shell/PoiChips.js';

function entfernungText(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

/** Nur http(s)-Adressen als Link -- ein `javascript:` aus OSM wäre keiner. */
function sichereUrl(roh: string | undefined): string | null {
  if (!roh) return null;
  const mitSchema = /^https?:\/\//i.test(roh) ? roh : `https://${roh}`;
  try {
    const u = new URL(mitSchema);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function favoritKategorie(symbol: string | null): 'campsite' | 'poi' {
  return symbol === 'poi-wohnmobil' || symbol === 'poi-camping' ? 'campsite' : 'poi';
}

function OnlineTeil({ ort }: { ort: GewaehlterOrt }): React.ReactElement {
  const [ergebnis, setErgebnis] = useState<OrtErgebnis | null>(null);

  useEffect(() => {
    let gueltig = true;
    setErgebnis(null);
    void holeOrtInfo({ lat: ort.lat, lon: ort.lon, name: ort.name }).then((e) => {
      if (gueltig) setErgebnis(e);
    });
    return () => {
      gueltig = false;
    };
  }, [ort.lat, ort.lon, ort.name]);

  if (!ergebnis) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="ort-online-laedt">
        Infos aus dem Internet werden geladen …
      </p>
    );
  }
  if (ergebnis.art === 'aus') {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="ort-online-aus">
        Mehr Infos (Öffnungszeiten, Wikipedia, Bilder) gibt es, wenn „online" in der
        Add-on-Konfiguration eingeschaltet ist.
      </p>
    );
  }
  if (ergebnis.art === 'fehler') {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="ort-online-fehler">
        Keine Infos aus dem Internet: {ergebnis.text}
      </p>
    );
  }

  const { osm, wikipedia, bilder } = ergebnis.info;
  const web = sichereUrl(osm?.website);
  const leer = !osm && !wikipedia && bilder.length === 0;

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="ort-online">
      {leer && <p className="text-slate-500 dark:text-slate-400">Im Internet ist zu diesem Ort nichts zu finden.</p>}
      {osm && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="ort-osm">
          {osm.oeffnungszeiten && (
            <>
              <dt className="text-slate-500">🕘</dt>
              <dd>{osm.oeffnungszeiten}</dd>
            </>
          )}
          {web && (
            <>
              <dt className="text-slate-500">🌐</dt>
              <dd className="truncate">
                <a href={web} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">
                  {web.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </dd>
            </>
          )}
          {osm.telefon && (
            <>
              <dt className="text-slate-500">📞</dt>
              <dd>
                <a href={`tel:${osm.telefon.replace(/[^+\d]/g, '')}`} className="text-blue-600 underline dark:text-blue-400">
                  {osm.telefon}
                </a>
              </dd>
            </>
          )}
          {osm.gebuehr && (
            <>
              <dt className="text-slate-500">💶</dt>
              <dd>{osm.gebuehr}</dd>
            </>
          )}
          {osm.beschreibung && (
            <>
              <dt className="text-slate-500">ℹ️</dt>
              <dd>{osm.beschreibung}</dd>
            </>
          )}
        </dl>
      )}
      {osm && osm.merkmale.length > 0 && (
        <ul className="flex flex-wrap gap-1" data-testid="ort-merkmale">
          {osm.merkmale.map((m) => (
            <li key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">
              {m}
            </li>
          ))}
        </ul>
      )}
      {wikipedia && (
        <div data-testid="ort-wikipedia">
          <p className="line-clamp-6">{wikipedia.auszug}</p>
          <a href={wikipedia.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline dark:text-blue-400">
            Wikipedia: {wikipedia.titel}
          </a>
        </div>
      )}
      {bilder.length > 0 && (
        <div className="grid grid-cols-3 gap-1" data-testid="ort-bilder">
          {bilder.map((b) => (
            <a key={b.quelle} href={b.quelle} target="_blank" rel="noopener noreferrer" className="relative block">
              <img src={b.daten} alt="" className="aspect-square w-full rounded object-cover" />
              {b.art === 'umgebung' && (
                <span className="absolute bottom-0 left-0 right-0 rounded-b bg-black/50 px-1 text-[10px] text-white">
                  in der Nähe
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrtKarte(): React.ReactElement | null {
  const ort = useOrtStore((s) => s.ort);
  const schliesse = useOrtStore((s) => s.schliesse);
  const position = usePositionStore((s) => s.position);
  const createFavorite = useFavoritesStore((s) => s.createFavorite);
  const [favorit, setFavorit] = useState<'nein' | 'gespeichert' | 'fehler'>('nein');

  useEffect(() => setFavorit('nein'), [ort]);

  // Ein anderswo gesetztes Ziel (Suche, langer Druck, Favorit) ersetzt die
  // Karte -- dann ist ein anderer Ort gemeint.
  useEffect(
    () =>
      useRoutingStore.subscribe((s, vorher) => {
        if (s.destination !== vorher.destination) useOrtStore.getState().schliesse();
      }),
    [],
  );

  if (!ort) return null;

  const abstand = position ? haversineMeters({ lat: position.lat, lon: position.lon }, ort) : null;
  const zeichen = (ort.symbol && CHIP_ZEICHEN[ort.symbol]) || '📍';
  const titel = ort.name ?? ort.kategorie ?? 'Ort';

  const route = (): void => {
    const routing = useRoutingStore.getState();
    routing.setDestination({ lat: ort.lat, lon: ort.lon }, ort.name ?? ort.kategorie);
    void routing.requestRoute({
      origin: 'current',
      profileId: useProfileStore.getState().activeProfile?.id,
    });
    schliesse();
  };

  const merken = async (): Promise<void> => {
    const kategorie = favoritKategorie(ort.symbol);
    try {
      await createFavorite({
        name: titel,
        latlng: { lat: ort.lat, lon: ort.lon },
        icon: iconForFavoriteCategory(kategorie),
        category: kategorie,
      });
      setFavorit('gespeichert');
    } catch {
      setFavorit('fehler');
    }
  };

  return (
    <section
      className="pointer-events-auto flex max-h-[calc(var(--sicht-h,100vh)-150px)] flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-lg dark:bg-slate-800 dark:text-slate-100"
      aria-label={`Ort: ${titel}`}
      data-testid="ort-karte"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden="true">
          {zeichen}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" data-testid="ort-name">
            {titel}
          </h2>
          {ort.kategorie && ort.name && (
            <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="ort-kategorie">
              {ort.kategorie}
            </p>
          )}
          {ort.adresse && <p className="text-sm text-slate-600 dark:text-slate-300">{ort.adresse}</p>}
          {abstand !== null && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="ort-abstand">
              {entfernungText(abstand)} Luftlinie
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={schliesse}
          aria-label="Ortskarte schließen"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="ort-schliessen"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={route}
          className="flex-1 rounded-full bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          data-testid="ort-route"
        >
          Route
        </button>
        <button
          type="button"
          onClick={() => void merken()}
          disabled={favorit === 'gespeichert'}
          className="rounded-full border border-slate-300 px-4 py-2 hover:bg-slate-100 disabled:opacity-70 dark:border-slate-600 dark:hover:bg-slate-700"
          data-testid="ort-favorit"
        >
          {favorit === 'gespeichert' ? '★ Gemerkt' : '☆ Favorit'}
        </button>
      </div>
      {favorit === 'fehler' && <p className="text-sm text-red-600">Favorit konnte nicht gespeichert werden.</p>}

      <OnlineTeil ort={ort} />
    </section>
  );
}
