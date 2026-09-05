/**
 * Region manager panel (E01-T5, docs/03-api-spec.md §2): lists installed
 * regions (delete) and the downloadable-regions catalog (download, with
 * live job-progress polling). Coverage is shown as a bounds text line
 * (W-09: "Region-Manager zeigt Abdeckung" -- a mini-map is optional per the
 * task spec, and a text line is simpler/more testable than embedding a
 * second MapLibre instance for this preliminary panel). Disk-full (409
 * INSUFFICIENT_SPACE) and last-region (409 LAST_REGION) errors are shown
 * with a plain-language message + the byte calculation, not a raw error
 * code.
 *
 * Follows the same toggle-FAB + floating panel pattern as StylePanel
 * (E01-T4). Positioned top-right (below MapLibre's own NavigationControl,
 * which claims the very top of that corner) so it doesn't overlap
 * StylePanel (bottom-left) or the compass/view-mode/re-center FABs
 * (bottom-right).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUiStore } from '../../ui/store.js';
import DriveLockGate from '../../drive/DriveLockGate.js';
import BuildStatusSection from './BuildStatusSection.js';
import {
  deleteRegion,
  fetchCatalog,
  fetchInstalledRegions,
  fetchJob,
  startDownload,
  startBuild,
  startGraphBuild,
  startSearchIndexBuild,
  RegionApiError,
  type CatalogRegion,
  type InstalledRegion,
  type JobSnapshot,
} from './client';

import { TOP_RIGHT_INSET_PX } from '../../shell/mapControlLayout.js';
const JOB_POLL_INTERVAL_MS = 400;

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatBounds(bounds: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return `${minLat.toFixed(2)}°..${maxLat.toFixed(2)}° N, ${minLon.toFixed(2)}°..${maxLon.toFixed(2)}° E`;
}

function formatApiError(err: RegionApiError): string {
  if (err.code === 'INSUFFICIENT_SPACE') {
    const required =
      typeof err.details?.requiredBytes === 'number' ? formatBytes(err.details.requiredBytes) : 'unbekannt';
    const free = typeof err.details?.freeBytes === 'number' ? formatBytes(err.details.freeBytes) : 'unbekannt';
    return `Nicht genug freier Speicherplatz: benötigt ${required}, verfügbar ${free}.`;
  }
  if (err.code === 'LAST_REGION') {
    return 'Die letzte installierte Region kann nicht gelöscht werden.';
  }
  if (err.code === 'ALREADY_INSTALLED') {
    return 'Diese Region ist bereits installiert.';
  }
  if (err.code === 'NOT_FOUND') {
    return 'Region nicht gefunden.';
  }
  // B-04: der Bau ist der speicherhungrigste Schritt der ganzen Kette. Die
  // Ablehnung nennt deshalb den Ausweg, nicht nur die Zahl -- auf einer
  // 8-GB-VM ist Photon abzuschalten ohnehin die empfohlene Einstellung.
  if (err.code === 'INSUFFICIENT_MEMORY') {
    const required =
      typeof err.details?.requiredBytes === 'number' ? formatBytes(err.details.requiredBytes) : 'unbekannt';
    const free = typeof err.details?.freeBytes === 'number' ? formatBytes(err.details.freeBytes) : 'unbekannt';
    return (
      `Zu wenig freier Arbeitsspeicher: benötigt ${required}, frei ${free}. ` +
      'Schalte Photon in der Add-on-Konfiguration ab („photon_enabled: false") und versuche es erneut.'
    );
  }
  if (err.code === 'NO_BUILD_SOURCE') {
    return 'Für diese Region ist kein OpenStreetMap-Extrakt hinterlegt — es gibt nichts zu bauen.';
  }
  if (err.code === 'BUILD_IN_PROGRESS') {
    // Der Grund gehoert in die Meldung. „Geht gerade nicht" liest sich wie
    // eine Schikane; die beiden echten Gruende erklaeren das Verbot.
    //
    // Die Sperre gilt fuer Kachel- UND Routingbau gemeinsam, deshalb nennt
    // der Text keinen der beiden beim Namen: zwei Kachelbauten zerstoeren
    // einander ueber die gemeinsamen Basisdaten, und ein Kachel- neben einem
    // Routingbau sprengt den Speicher der 8-GB-VM, auf der auch Home
    // Assistant laeuft.
    return (
      'Es läuft bereits ein Bau. Zwei gleichzeitig gehen nicht: sie teilen sich ' +
      'dieselben Basisdaten und denselben Arbeitsspeicher. Warte das Ende ab oder ' +
      'brich den laufenden Bau ab.'
    );
  }
  return err.message || 'Unbekannter Fehler.';
}

interface DownloadState {
  jobId: string;
  job: JobSnapshot | null;
}

/**
 * Fortschritt eines laufenden Jobs. Lag frueher nur im Katalog-Abschnitt --
 * und fehlte damit ausgerechnet dort, wo der Routingbau stattfindet: bei
 * einer bereits INSTALLIERTEN Region. Ein mehrminuetiger Lauf ohne jede
 * Anzeige ist von einem Haenger nicht zu unterscheiden.
 */
function JobProgress({ regionId, job }: { regionId: string; job: JobSnapshot }): React.ReactElement {
  // ─── DER ABSCHLUSS GEHOERT DAZU ───────────────────────────────────────────
  // Frueher wurde diese Anzeige bei `status === 'done'` gar nicht mehr
  // gerendert: der Balken verschwand, und uebrig blieb eine Oberflaeche, die
  // aussah wie vor dem Klick. Ob der Bau geglueckt oder still gestorben war,
  // liess sich nicht unterscheiden -- man musste ins Add-on-Protokoll sehen,
  // also genau dorthin, wohin der GUI-Weg NICHT fuehren soll.
  //
  // Ein Bau dauert Minuten. Das Ergebnis eines mehrminuetigen Vorgangs
  // kommentarlos verschwinden zu lassen, ist keine Sparsamkeit, sondern eine
  // Luecke.
  if (job.status === 'done') {
    return (
      <p
        className="mt-1 text-xs text-emerald-700 dark:text-emerald-400"
        data-testid={`job-done-${regionId}`}
      >
        ✓ {job.note ?? 'Fertig.'}
      </p>
    );
  }
  return (
    <div className="mt-1" data-testid={`download-progress-${regionId}`}>
      {/* Ein Bau hat keinen messbaren Fortschritt: die Ausgabe der
          Bauwerkzeuge laesst sich nicht versionsstabil in eine Zahl
          uebersetzen. Statt eine Prozentzahl zu erfinden, laeuft der Balken
          unbestimmt und darunter steht die letzte Ausgabezeile (`job.note`).
          Downloads haben eine echte Byte-Zahl und behalten ihre Prozente. */}
      <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={
            job.totalBytes === null
              ? 'h-full w-1/3 bg-blue-500 animate-pulse'
              : 'h-full bg-blue-500 transition-[width]'
          }
          style={
            job.totalBytes === null ? undefined : { width: `${Math.round(job.progress * 100)}%` }
          }
        />
      </div>
      <div
        className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"
        data-testid={`job-status-${regionId}`}
      >
        {job.status === 'error'
          ? `Fehler: ${job.error?.message ?? 'Vorgang fehlgeschlagen'}`
          : job.totalBytes === null
            ? (job.note ?? 'Läuft…')
            : `${Math.round(job.progress * 100)}%`}
      </div>
    </div>
  );
}

export default function RegionsPanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [installed, setInstalled] = useState<InstalledRegion[]>([]);
  const [catalog, setCatalog] = useState<CatalogRegion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [errorByRegion, setErrorByRegion] = useState<Record<string, string>>({});

  // E03-T6: Listen to UI store to open the panel from RoutingPanel
  const regionsPanelOpen = useUiStore((state) => state.regionsPanel.isOpen);
  useEffect(() => {
    if (regionsPanelOpen) {
      setIsOpen(true);
    }
  }, [regionsPanelOpen]);

  // Read inside the polling interval via a ref so the interval effect
  // doesn't need to restart every time a job's progress updates.
  const downloadsRef = useRef<Record<string, DownloadState>>({});
  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  const refresh = useCallback(async () => {
    const [installedRegions, catalogRegions] = await Promise.all([
      fetchInstalledRegions(),
      fetchCatalog(),
    ]);
    setInstalled(installedRegions);
    setCatalog(catalogRegions);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!isOpen || loaded) {
      return;
    }
    void refresh();
  }, [isOpen, loaded, refresh]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const interval = setInterval(() => {
      const active = Object.entries(downloadsRef.current).filter(
        ([, state]) => !state.job || (state.job.status !== 'done' && state.job.status !== 'error'),
      );
      if (active.length === 0) {
        return;
      }
      void Promise.all(
        active.map(async ([regionId, state]) => {
          const job = await fetchJob(state.jobId);
          setDownloads((prev) =>
            prev[regionId] ? { ...prev, [regionId]: { jobId: state.jobId, job } } : prev,
          );
          if (job && (job.status === 'done' || job.status === 'error')) {
            void refresh();
          }
        }),
      );
    }, JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOpen, refresh]);

  const handleDownload = useCallback(async (regionId: string) => {
    setErrorByRegion((prev) => ({ ...prev, [regionId]: '' }));
    try {
      const jobId = await startDownload(regionId);
      setDownloads((prev) => ({ ...prev, [regionId]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError ? formatApiError(err) : 'Download konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [regionId]: message }));
    }
  }, []);

  // B-04: der Bau nutzt DIESELBE Job-Maschinerie wie der Download --
  // derselbe `downloads`-State, dasselbe Polling, dieselbe Fortschritts-
  // anzeige. Nur der Auslöser ist ein anderer.
  const handleBuild = useCallback(async (regionId: string) => {
    setErrorByRegion((prev) => ({ ...prev, [regionId]: '' }));
    try {
      const jobId = await startBuild(regionId);
      setDownloads((prev) => ({ ...prev, [regionId]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError ? formatApiError(err) : 'Bau konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [regionId]: message }));
    }
  }, []);

  // Der Routinggraph ist ein EIGENES Erzeugnis aus derselben PBF. Er teilt
  // sich Job-Maschinerie und Sperre mit dem Kachelbau -- zwei schwere Bauten
  // nebeneinander sprengen den Speicher der 8-GB-VM.
  const handleGraphBuild = useCallback(async (regionId: string) => {
    setErrorByRegion((prev) => ({ ...prev, [regionId]: '' }));
    try {
      const jobId = await startGraphBuild(regionId);
      setDownloads((prev) => ({ ...prev, [regionId]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError
          ? formatApiError(err)
          : 'Bau des Routinggraphen konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [regionId]: message }));
    }
  }, []);

  // Dritter Bau-Weg neben Kacheln und Routinggraph. Bis 0.3.3 gab es ihn
  // nicht -- die Oberflaeche sagte stattdessen, der Index lasse sich nur auf
  // einem anderen Rechner bauen. Das war eine Verpackungsentscheidung, keine
  // Grenze (siehe yapaja_go/Dockerfile, KORREKTUR 0.3.4).
  const handleSearchIndexBuild = useCallback(async (regionId: string) => {
    setErrorByRegion((prev) => ({ ...prev, [regionId]: '' }));
    try {
      const jobId = await startSearchIndexBuild(regionId);
      setDownloads((prev) => ({ ...prev, [regionId]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError
          ? formatApiError(err)
          : 'Bau des Suchindex konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [regionId]: message }));
    }
  }, []);

  const handleDelete = useCallback(
    async (regionId: string) => {
      setErrorByRegion((prev) => ({ ...prev, [regionId]: '' }));
      try {
        await deleteRegion(regionId);
        await refresh();
      } catch (err) {
        const message =
          err instanceof RegionApiError ? formatApiError(err) : 'Region konnte nicht gelöscht werden.';
        setErrorByRegion((prev) => ({ ...prev, [regionId]: message }));
      }
    },
    [refresh],
  );

  const toggleOpen = useCallback(() => setIsOpen((open) => !open), []);

  const downloadableCatalog = catalog.filter((entry) => !entry.installed);

  return (
    <div className="fixed z-10" style={{ top: 80, right: TOP_RIGHT_INSET_PX }}>
      {isOpen && (
        <div
          className="absolute top-14 right-0 mb-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4"
          data-testid="regions-panel"
        >
          {/* Speed-Lock (E07-T4): "Store" (region/map management) is one of
              docs/06 §4's "complex dialogs" gated above the configured
              threshold -- see StylePanel.tsx's identical gate for the
              reachable-FAB-while-locked rationale. */}
          <DriveLockGate controlId="store">
          <section>
            <BuildStatusSection />

            <h2 className="font-semibold mb-2 mt-4">Installierte Regionen</h2>
            {installed.length === 0 && (
              <p
                className="text-slate-500 dark:text-slate-400 text-xs"
                data-testid="regions-installed-empty"
              >
                Keine Karte installiert.
              </p>
            )}
            <ul className="space-y-2">
              {installed.map((region) => {
                // Sobald die KACHELN installiert sind, verschwindet die Region
                // aus „Verfuegbare Regionen" -- und damit verschwand auch der
                // Knopf „Routing bauen", der dort stand. Der Routinggraph ist
                // aber ein ZWEITES, unabhaengiges Erzeugnis: wer die Karte
                // gebaut hat, hat noch lange kein Routing. Der Betreiber stand
                // damit vor einer Oberflaeche ohne jeden Weg zum Graphen und
                // versuchte, die Karte zu loeschen, um den Knopf
                // zurueckzubekommen -- was die Letzte-Region-Regel (zu Recht)
                // ebenfalls verweigert. Eine Sackgasse mit zwei Waenden.
                //
                // Deshalb steht der Knopf jetzt AUCH hier. `pbfUrl` kommt aus
                // dem Katalog; ohne Quelle gibt es nichts zu bauen.
                const catalogEntry = catalog.find((candidate) => candidate.id === region.region);
                const state = downloads[region.region];
                const job = state?.job ?? null;
                const isActive = Boolean(state) && (!job || (job.status !== 'done' && job.status !== 'error'));
                return (
                <li
                  key={region.region}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-2"
                  data-testid={`installed-region-${region.region}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{region.region}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatBytes(region.size_bytes)} · {formatBounds(region.bounds)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {catalogEntry?.pbfUrl ? (
                        <button
                          onClick={() => void handleGraphBuild(region.region)}
                          disabled={isActive}
                          className="px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                          data-testid={`graph-build-button-${region.region}`}
                        >
                          {isActive ? 'Baut…' : 'Routing bauen'}
                        </button>
                      ) : null}
                      {catalogEntry?.pbfUrl ? (
                        <button
                          onClick={() => void handleSearchIndexBuild(region.region)}
                          disabled={isActive}
                          className="px-2 py-1 rounded-md border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-400 text-xs hover:bg-sky-50 dark:hover:bg-sky-900/30 disabled:opacity-50"
                          data-testid={`search-index-build-button-${region.region}`}
                        >
                          {isActive ? 'Baut…' : 'Suche bauen'}
                        </button>
                      ) : null}
                      <button
                        onClick={() => void handleDelete(region.region)}
                        className="px-2 py-1 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs hover:bg-red-50 dark:hover:bg-red-900/30"
                        data-testid={`delete-button-${region.region}`}
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                  {job && <JobProgress regionId={region.region} job={job} />}
                  {errorByRegion[region.region] && (
                    <p
                      className="mt-1 text-xs text-red-600 dark:text-red-400"
                      data-testid={`region-error-${region.region}`}
                    >
                      {errorByRegion[region.region]}
                    </p>
                  )}
                </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-2">Verfügbare Regionen</h2>
            {loaded && downloadableCatalog.length === 0 && (
              <p className="text-slate-500 dark:text-slate-400 text-xs" data-testid="regions-catalog-empty">
                Alle Regionen aus dem Katalog sind bereits installiert.
              </p>
            )}
            <ul className="space-y-2">
              {downloadableCatalog.map((entry) => {
                const download = downloads[entry.id];
                const job = download?.job;
                const isActive = !!download && (!job || (job.status !== 'done' && job.status !== 'error'));
                return (
                  <li
                    key={entry.id}
                    className="border border-slate-200 dark:border-slate-700 rounded-lg p-2"
                    data-testid={`catalog-region-${entry.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{entry.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {formatBytes(entry.sizeBytes)} · {formatBounds(entry.bounds)}
                        </div>
                      </div>
                      {entry.url ? (
                        <button
                          onClick={() => void handleDownload(entry.id)}
                          disabled={isActive}
                          className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                          data-testid={`download-button-${entry.id}`}
                        >
                          Herunterladen
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleBuild(entry.id)}
                          disabled={isActive || !entry.pbfUrl}
                          className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                          data-testid={`build-button-${entry.id}`}
                        >
                          {isActive ? 'Baut…' : 'Kacheln bauen'}
                        </button>
                      )}
                      {/* Der Routinggraph ist ein zweites Erzeugnis aus
                          derselben PBF und wird SEPARAT gebaut: viele
                          Betreiber wollen erst die Karte sehen, und der
                          Graph kostet noch einmal Zeit und Speicher. */}
                      {entry.pbfUrl ? (
                        <button
                          onClick={() => void handleGraphBuild(entry.id)}
                          disabled={isActive}
                          className="shrink-0 px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                          data-testid={`graph-build-button-${entry.id}`}
                        >
                          Routing bauen
                        </button>
                      ) : null}
                      {/* Und der Suchindex als drittes -- ebenfalls aus
                          derselben PBF, ebenfalls separat: er ist die
                          Voraussetzung fuer die Adresssuche und sonst nichts.
                          Wer nur zu angetippten Punkten und Favoriten faehrt,
                          braucht ihn nie. */}
                      {entry.pbfUrl ? (
                        <button
                          onClick={() => void handleSearchIndexBuild(entry.id)}
                          disabled={isActive}
                          className="shrink-0 px-2 py-1 rounded-md border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-400 text-xs hover:bg-sky-50 dark:hover:bg-sky-900/30 disabled:opacity-50"
                          data-testid={`search-index-build-button-${entry.id}`}
                        >
                          Suche bauen
                        </button>
                      ) : null}
                    </div>
                    {/* Ein Eintrag ohne `url` hat keine fertige Datei zum
                        Herunterladen -- die Kacheln entstehen aus dem
                        OSM-Extrakt. Vorher stand hier trotzdem ein
                        „Herunterladen"-Knopf, der sicher scheiterte: der
                        Katalog nannte Geofabrik-`.pmtiles`-URLs, die es nie
                        gab (404). Ein Knopf, der nicht funktionieren KANN,
                        ist schlimmer als kein Knopf -- er schickt den
                        Betreiber auf die Fehlersuche in seiner eigenen
                        Installation. */}
                    {!entry.url && (
                      <p
                        className="mt-1 text-xs text-slate-600 dark:text-slate-300"
                        data-testid={`build-hint-${entry.id}`}
                      >
                        {entry.note ??
                          (entry.buildEffort === 'large'
                            ? 'Große Region: den Kachelbau nicht auf diesem Gerät ausführen.'
                            : 'Die Kacheln für diese Region werden aus OpenStreetMap-Daten gebaut.')}{' '}
                        Anleitung: <code>docs/installation.md</code> §C.
                      </p>
                    )}
                    {job && <JobProgress regionId={entry.id} job={job} />}
                    {errorByRegion[entry.id] && (
                      <p
                        className="mt-1 text-xs text-red-600 dark:text-red-400"
                        data-testid={`region-error-${entry.id}`}
                      >
                        {errorByRegion[entry.id]}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          </DriveLockGate>
        </div>
      )}

      <button
        onClick={toggleOpen}
        className="w-12 h-12 rounded-full bg-white/90 dark:bg-slate-800/90 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg"
        aria-label="Kartenregionen verwalten"
        aria-expanded={isOpen}
        title="Kartenregionen verwalten"
        data-testid="regions-panel-toggle"
      >
        🗺️
      </button>
    </div>
  );
}
