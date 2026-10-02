/**
 * Das Fahrtmenü: was man während der Fahrt SELTEN braucht, einen Tipp entfernt.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „wir haben so viele tolle Informationen dass man während der Fahrt zu viele
 * Dinge sieht. […] Vielleicht könne wir auch Dinge verschachteln. Also bspw
 * braucht es den Favoriten Block nicht während der Navigation. Außer man will
 * einen Parkplatz oder Tankstelle als zwischenziel aussuchen. Wenn das
 * vielleicht hinter den aktuellen fahrtdaten (eta, Uhrzeit, restkilometer)
 * verschachtelt. […] Analog auch Pause und Stopp der Navigation dar gerne
 * über 2 Klicks erreichbar sein und hinter dieses Menü verschachtelt werden."
 *
 * ─── WAS HIER LIEGT ─────────────────────────────────────────────────────────
 * Hinter einem Tipp auf die Fahrtdaten:
 *
 *   Pause · Stopp · Ansagen an/aus
 *   Unterwegs finden — ⛽ 🅿️ 🚐 …: die nächsten Treffer voraus auf der Strecke
 *   Zwischenstopp einschieben — aus Favoriten und zuletzt angefahrenen Zielen
 *   Fahrzeug — das Profil wechseln (die Kopfzeile mit der Fahrzeugwahl ist
 *   waehrend der Fahrt ausgeblendet; der Wechsel mit Neuberechnung ist aber
 *   eine Fahrfunktion, siehe `profiles/ProfileChangeBanner.tsx`)
 *
 * Vorher standen Pause, Stopp und „Ansagen an" als drei grosse Knöpfe
 * dauerhaft im Bild, und die Favoriten-Schublade lag über den Fahrtdaten.
 *
 * ─── WAS DRAUSSEN BLEIBT ────────────────────────────────────────────────────
 * „Fortsetzen" bei einer PAUSIERTEN Fahrt. Wer pausiert hat, will als
 * Nächstes genau das — es hinter ein Menü zu legen hiesse, die häufigste
 * Handlung dieses Zustands zu verstecken.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { LatLng, NavState } from '@yapaia/shared';
import { pauseNavigation, resumeNavigation, stopNavigation, NavigationApiError } from './client.js';
import { useNavStore } from './navStore.js';
import { useTtsStore } from './ttsStore.js';
import { announce, cancelSpeech, unlockAudio } from './tts.js';
import TripInfoPanel from './TripInfoPanel.js';
import UnterwegsFinden, { type UnterwegsErgebnis } from './UnterwegsFinden.js';
import UnterwegsVorschau, { type Vorschau } from './UnterwegsVorschau.js';
import { stationsZeile, useBordStore } from '../bord/bordStore.js';
import { stationAlsHalt } from '../bord/BordHinweis.js';
import { useFavoritesStore } from '../favorites/store.js';
import { iconForFavoriteCategory } from '../favorites/icons.js';
import { useRoutingStore } from '../routing/store.js';
import { useProfileStore } from '../profiles/store.js';
import WaypointList from '../routing/WaypointList.js';
import { useKartenSeite } from '../shell/bedienSeite.js';
import { useSchmal } from '../shell/useSchmal.js';
import { FAHRT_SEITENABSTAND_PX, STACK_GAP_PX, TRIP_BAR_HEIGHT_PX, tripInfoBottomPx } from '../shell/mapControlLayout.js';

/** Wie viele zuletzt angefahrene Ziele im Menü stehen. */
export const VERLAUF_IM_MENUE = 5;

/** Ein Ziel, das man als Zwischenstopp einschieben kann. */
export interface Stoppwahl {
  schluessel: string;
  name: string;
  latlng: LatLng;
  symbol: string;
}

/**
 * Favoriten zuerst, dann der Verlauf — ohne Doppelte.
 *
 * Doppelt heisst: dieselbe Stelle. Wer „Stellplatz Bodensee" als Favoriten
 * hat und gestern dorthin gefahren ist, bekommt ihn einmal angeboten, nicht
 * zweimal untereinander.
 */
export function stoppAuswahl(
  favoriten: ReadonlyArray<{ id: string; name: string; latlng: LatLng; category: Parameters<typeof iconForFavoriteCategory>[0] }>,
  verlauf: ReadonlyArray<{ id: string; destination: { latlng: LatLng; name: string | null } | null }>,
): Stoppwahl[] {
  const raus: Stoppwahl[] = favoriten.map((f) => ({
    schluessel: `fav-${f.id}`,
    name: f.name,
    latlng: f.latlng,
    symbol: iconForFavoriteCategory(f.category),
  }));
  const gleich = (a: LatLng, b: LatLng): boolean =>
    Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
  let ausVerlauf = 0;
  for (const e of verlauf) {
    if (ausVerlauf >= VERLAUF_IM_MENUE) break;
    const ziel = e.destination;
    if (!ziel) continue;
    if (raus.some((r) => gleich(r.latlng, ziel.latlng))) continue;
    raus.push({
      schluessel: `hist-${e.id}`,
      name: ziel.name ?? `${ziel.latlng.lat.toFixed(4)}, ${ziel.latlng.lon.toFixed(4)}`,
      latlng: ziel.latlng,
      symbol: '🕘',
    });
    ausVerlauf++;
  }
  return raus;
}

export default function FahrtMenue({ navState }: { navState: NavState | null }): React.ReactElement {
  const status = navState?.status ?? null;
  const setNavState = useNavStore((state) => state.setNavState);
  const ttsAn = useTtsStore((state) => state.enabled);
  const ttsUmschalten = useTtsStore((state) => state.toggle);
  const favoriten = useFavoritesStore((s) => s.favorites);
  const verlauf = useFavoritesStore((s) => s.history);
  const zwischenstoppVorn = useRoutingStore((s) => s.zwischenstoppVorn);
  const bordHinweise = useBordStore((s) => s.hinweise);
  const profile = useProfileStore((s) => s.profiles);
  const aktivesProfil = useProfileStore((s) => s.activeProfile);
  const profilAktivieren = useProfileStore((s) => s.activateProfile);
  const profileLaden = useProfileStore((s) => s.fetchProfiles);
  const zwischenziele = useRoutingStore((s) => s.waypoints);
  const kartenSeite = useKartenSeite();
  const schmal = useSchmal();

  const [offen, setOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eingeschoben, setEingeschoben] = useState<string | null>(null);
  // Erst ansehen, dann einfügen (UnterwegsVorschau.tsx). Das letzte Ergebnis
  // bleibt, damit „Liste" dorthin zurückführt, wo man war.
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [letztesUnterwegs, setLetztesUnterwegs] = useState<UnterwegsErgebnis | null>(null);

  // Die Profilliste frisch holen, sobald das Menue aufgeht -- wie die
  // Fahrzeugwahl in der Kopfzeile es beim Aufklappen tut.
  useEffect(() => {
    if (offen) void profileLaden();
  }, [offen, profileLaden]);

  // Die Bestätigung „… als nächster Halt" verschwindet von selbst.
  useEffect(() => {
    if (eingeschoben === null) return;
    const t = setTimeout(() => setEingeschoben(null), 4000);
    return () => clearTimeout(t);
  }, [eingeschoben]);

  const run = useCallback(
    async (action: () => Promise<NavState>) => {
      setBusy(true);
      setError(null);
      try {
        const state = await action();
        setNavState(state);
        setOffen(false);
      } catch (err) {
        setError(err instanceof NavigationApiError ? err.message : 'Aktion fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    },
    [setNavState],
  );

  const ansagenUmschalten = useCallback(() => {
    // Dieser Klick IST eine Nutzeraktion -- also hier die Tonfreigabe holen,
    // falls sie noch fehlt (siehe `tts.ts#unlockAudio`).
    unlockAudio();
    ttsUmschalten();
    if (ttsAn) {
      cancelSpeech();
    } else {
      // Einschalten und nichts hören ist genau die Lage, in der man nicht
      // weiss, ob die Ansagen aus sind oder nur nichts anzusagen war.
      announce('Ansagen sind an.');
    }
  }, [ttsAn, ttsUmschalten]);

  const einschieben = useCallback(
    (wahl: Stoppwahl) => {
      const profileId = useProfileStore.getState().activeProfile?.id;
      // Waehrend der Fahrt geht die Aenderung an den Core (siehe
      // `routing/store.ts#applyWaypointChange`); die Parameter braucht es nur
      // ausserhalb einer Fahrt.
      zwischenstoppVorn(wahl.latlng, wahl.name, { origin: 'current', profileId });
      setEingeschoben(wahl.name);
      setOffen(false);
    },
    [zwischenstoppVorn],
  );

  const auswahl = stoppAuswahl(favoriten, verlauf);
  const pausiert = status === 'paused';

  return (
    <>
      {pausiert && (
        <button
          type="button"
          onClick={() => void run(resumeNavigation)}
          disabled={busy}
          aria-label="Navigation fortsetzen"
          style={{ bottom: tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX + STACK_GAP_PX }}
          className="absolute left-1/2 z-20 min-h-[64px] min-w-[64px] -translate-x-1/2 rounded-full bg-blue-600 px-6 py-2 text-base font-semibold text-white shadow-lg disabled:opacity-50"
          data-testid="drive-resume-button"
          hidden={offen}
        >
          ▶ Fortsetzen
        </button>
      )}

      {eingeschoben && !offen && (
        <p
          role="status"
          style={{ bottom: tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX + STACK_GAP_PX }}
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-lg bg-slate-900/90 px-3 py-2 text-sm text-white shadow-lg"
          data-testid="fahrt-menue-eingeschoben"
        >
          Nächster Halt: {eingeschoben}
        </p>
      )}

      {vorschau && !offen && (
        <UnterwegsVorschau
          vorschau={vorschau}
          bottomPx={tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX + STACK_GAP_PX}
          onBlaettern={(index) => setVorschau({ ...vorschau, index })}
          onEinfuegen={() => {
            const t = vorschau.ergebnis.treffer[vorschau.index]!;
            const profileId = useProfileStore.getState().activeProfile?.id;
            zwischenstoppVorn({ lat: t.lat, lon: t.lon }, t.name, { origin: 'current', profileId });
            setEingeschoben(t.name);
            setVorschau(null);
            setLetztesUnterwegs(null);
          }}
          onListe={() => {
            setVorschau(null);
            setOffen(true);
          }}
          onSchliessen={() => setVorschau(null)}
        />
      )}

      {offen && (
        <div
          id="fahrt-menue"
          role="dialog"
          aria-label="Fahrtmenü"
          // ─── SEITLICH, GEGENUEBER DEM BLAUEN PUNKT (0.27) ──────────────
          // Gewuenscht: „Das Navi-Menue darf jetzt auch gerne eher links
          // oder rechts angeordnet sein." In 0.26 auf der Fahrerseite --
          // dort sitzt aber der blaue Punkt, und das Menue verdeckte ihn.
          // Jetzt auf der Kartenseite, ueber der Fahrtleiste (TripInfoPanel).
          // Auf dem Telefon bleibt es mittig.
          style={{
            bottom: tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX + STACK_GAP_PX,
            ...(schmal ? {} : { [kartenSeite]: FAHRT_SEITENABSTAND_PX }),
          }}
          className={`absolute z-30 max-h-[calc(var(--sicht-h,100vh)*0.7)] space-y-3 overflow-y-auto rounded-xl bg-white/95 p-3 text-sm text-slate-800 shadow-xl dark:bg-slate-800/95 dark:text-slate-100 ${
            schmal
              ? 'left-1/2 w-[min(calc(var(--sicht-b,100vw)*0.92),26rem)] -translate-x-1/2'
              : 'w-[min(calc(100%-24px),26rem)]'
          }`}
          data-testid="fahrt-menue"
        >
          {error && (
            <p
              className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
              data-testid="drive-controls-error"
            >
              {error}
            </p>
          )}
          <div className="flex gap-2" data-testid="drive-controls">
            {!pausiert && (
              <button
                type="button"
                onClick={() => void run(pauseNavigation)}
                disabled={busy}
                aria-label="Navigation pausieren"
                className="min-h-[64px] flex-1 rounded-xl bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50"
                data-testid="drive-pause-button"
              >
                ⏸ Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => void run(stopNavigation)}
              disabled={busy}
              aria-label="Navigation stoppen"
              className="min-h-[64px] flex-1 rounded-xl bg-red-600 px-3 py-2 font-medium text-white disabled:opacity-50"
              data-testid="drive-stop-button"
            >
              ⏹ Stopp
            </button>
            <button
              type="button"
              onClick={ansagenUmschalten}
              aria-pressed={ttsAn}
              aria-label={ttsAn ? 'Sprachansagen ausschalten' : 'Sprachansagen einschalten'}
              className="min-h-[64px] flex-1 rounded-xl bg-slate-200 px-3 py-2 font-medium text-slate-900 dark:bg-slate-700 dark:text-white"
              data-testid="tts-toggle"
            >
              {ttsAn ? '🔊 Ansagen an' : '🔇 Ansagen aus'}
            </button>
          </div>

          {bordHinweise.length > 0 && (
            // Die Bordhinweise bleiben hier nachlesbar, auch wenn man sie auf
            // der Karte mit „Später" weggetippt hat.
            <section aria-labelledby="fahrt-menue-bord" data-testid="fahrt-menue-bord">
              <h2 id="fahrt-menue-bord" className="mb-2 font-semibold">
                Bord
              </h2>
              <ul className="space-y-2">
                {bordHinweise.map((h) => (
                  <li key={h.art}>
                    <p>{h.text}</p>
                    {h.station && (
                      <button
                        type="button"
                        onClick={() => {
                          stationAlsHalt(h);
                          setEingeschoben(h.station!.name);
                          setOffen(false);
                        }}
                        className="mt-1 min-h-[48px] rounded-full bg-slate-100 px-3 py-2 text-left hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                        data-testid={`fahrt-menue-bord-${h.art}`}
                      >
                        {stationsZeile(h.station)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {zwischenziele.length > 0 && (
            // ─── ZWISCHENZIELE WAEHREND DER FAHRT (0.26) ─────────────────
            // Gemeldet: „Wenn navigiert wird, kann ich zwar Zwischenziele
            // setzen und sie werden auch nummeriert, aber ich finde sie nicht
            // mehr wieder, um sie bspw. in der Reihenfolge zu verschieben."
            // Dieselbe Liste wie beim Planen; waehrend der Fahrt geht jede
            // Aenderung an den Core (`routing/store.ts#applyWaypointChange`),
            // der die laufende Route neu rechnet.
            <section aria-label="Zwischenziele" data-testid="fahrt-menue-zwischenziele">
              <WaypointList rerouteParams={null} />
            </section>
          )}

          <UnterwegsFinden
            anfang={letztesUnterwegs}
            onGewaehlt={(_t, ergebnis, index) => {
              setLetztesUnterwegs(ergebnis);
              setVorschau({ ergebnis, index });
              setOffen(false);
            }}
          />

          <section aria-labelledby="fahrt-menue-stopp">
            <h2 id="fahrt-menue-stopp" className="mb-2 font-semibold">
              Zwischenstopp einschieben
            </h2>
            {auswahl.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="fahrt-menue-leer">
                Keine Favoriten und kein Verlauf. Favoriten legst du beim Planen einer Route an.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2" data-testid="fahrt-menue-stopps">
                {auswahl.map((wahl) => (
                  <li key={wahl.schluessel}>
                    <button
                      type="button"
                      onClick={() => einschieben(wahl)}
                      className="flex min-h-[48px] items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                      data-testid={`fahrt-menue-stopp-${wahl.schluessel}`}
                    >
                      <span aria-hidden="true">{wahl.symbol}</span>
                      <span>{wahl.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {profile.length > 1 && (
            <section aria-labelledby="fahrt-menue-fahrzeug">
              <h2 id="fahrt-menue-fahrzeug" className="mb-2 font-semibold">
                Fahrzeug
              </h2>
              <ul className="flex flex-wrap gap-2">
                {profile.map((p) => {
                  const aktiv = p.id === aktivesProfil?.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={aktiv}
                        disabled={aktiv}
                        onClick={() => {
                          // Die Rueckfrage „Mit '…' neu berechnen?" stellt
                          // `ProfileChangeBanner` -- derselbe Weg wie ueber die
                          // Kopfzeile.
                          void profilAktivieren(p.id).catch(() => {});
                          setOffen(false);
                        }}
                        className={`min-h-[48px] rounded-full px-3 py-2 ${
                          aktiv
                            ? 'bg-blue-600 font-semibold text-white'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600'
                        }`}
                        data-testid={`fahrt-menue-profil-${p.id}`}
                      >
                        🚐 {p.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      <TripInfoPanel navState={navState} offen={offen} onToggle={() => setOffen((o) => !o)} />
    </>
  );
}
