/**
 * Kartenverwaltung — EINE Liste, drei Handlungen, ein gemeinsamer Bau-Knopf.
 *
 * ─── WAS SICH IN 0.16.0 GEÄNDERT HAT ────────────────────────────────────────
 * Gewünscht:
 *
 *   „Das bedeutet der Anwender klickt bei einer Karte nur noch auf
 *    ‚installieren' (sofern nicht installiert), ‚Update' (bei installierten
 *    Karten zum Update) oder ‚löschen' falls bereits installiert.
 *    Dann gibt es noch einen gemeinsamen Knopf der nach einer neuen
 *    Installation oder Update alles wieder neu baut für eine gemeinsame
 *    Anzeige. Bitte hier dann ebenfalls mit Fortschrittsanzeige […] Wenn
 *    möglich mit einer geschätzten Zeit wann die Aktion fertig ist."
 *
 * Vorher: zwei Listen („Installierte" / „Verfügbare"), bis zu vier Knöpfe je
 * Eintrag (Herunterladen bzw. Kacheln bauen, Routing bauen, Suche bauen,
 * Löschen), und eine Karte wechselte beim Installieren die Liste und dabei
 * ihre Knöpfe.
 *
 * „Routing bauen" und „Suche bauen" sind ERZEUGNISSE, keine Handlungen. Wer
 * eine Karte installiert, will nicht wissen, welche Nebenprodukte es gibt,
 * sondern dass danach alles wieder passt. Dafür gibt es jetzt den einen
 * Knopf — und er sagt, wie weit er ist und wie lange es noch dauert.
 *
 * Die Zusammenführung der beiden Listen steht in `kartenliste.ts`: es ist
 * eine Entscheidung und keine Darstellung, und in einem React-Baustein wäre
 * sie nur noch im Browser zu erreichen.
 *
 * ─── ZUR RESTZEIT ───────────────────────────────────────────────────────────
 * Sie kommt fertig aus dem Kern (`bauzeit.ts`), samt der Unterscheidung
 * zwischen einer Schätzung und einer Untergrenze. Diese Oberfläche baut sie
 * NICHT nach: sie zeigt `restText`, wenn es einen gibt, und sagt sonst, dass
 * es noch keine Erfahrungswerte gibt. Eine erfundene Zahl wäre hier
 * besonders teuer — sie sieht überprüfbar aus.
 *
 * Positioniert wie StylePanel (E01-T4): Toggle-FAB oben rechts, unterhalb von
 * MapLibres eigener NavigationControl.
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
  fetchLaufenderBau,
  startDownload,
  startBuild,
  startGesamtbau,
  RegionApiError,
  type CatalogRegion,
  type InstalledRegion,
  type JobSnapshot,
} from './client';
import {
  kartenliste,
  istInstalliert,
  kannInstallieren,
  installierenText,
  type Karteneintrag,
} from './kartenliste.js';

import { TOP_RIGHT_INSET_PX, topRightSlotPx } from '../../shell/mapControlLayout.js';
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

/**
 * Der Schlüssel, unter dem der GESAMTBAU in der Job-Tabelle steht.
 *
 * Er gehört zu keiner einzelnen Karte — er baut über alle. Ihn unter einer
 * Region einzusortieren wäre bequem und falsch: dann stünde der Fortschritt
 * eines Laufs über fünf Länder ausgerechnet an einem davon.
 */
const GESAMT_SCHLUESSEL = '__gesamt__';

/** Wo ein Gesamtbau steht — Schritt, Balken, Restzeit. */
function GesamtFortschritt({ job }: { job: JobSnapshot }): React.ReactElement {
  const gesamt = job.gesamt;
  if (job.status === 'done') {
    return (
      <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400" data-testid="gesamtbau-fertig">
        ✓ {job.note ?? 'Alles neu gebaut.'}
      </p>
    );
  }
  if (job.status === 'error') {
    return (
      <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="gesamtbau-fehler">
        {job.error?.message ?? 'Der Bau ist fehlgeschlagen.'}
      </p>
    );
  }

  // ─── DER BALKEN ZEIGT DIE SCHRITTE, NICHT DEN LAUF ────────────────────────
  // Innerhalb eines Schrittes gibt es keinen messbaren Fortschritt (siehe
  // `build.ts`). Was es GIBT, ist die Zahl der erledigten Schritte — und das
  // ist eine echte Zahl, keine erfundene. Der Balken zeigt deshalb genau sie.
  const anteil = gesamt ? (gesamt.schritt - 1) / gesamt.schritte : 0;

  return (
    <div className="mt-2" data-testid="gesamtbau-fortschritt">
      <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-[width]"
          style={{ width: `${Math.round(anteil * 100)}%` }}
        />
      </div>
      {gesamt && (
        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid="gesamtbau-schritt">
          Schritt {gesamt.schritt} von {gesamt.schritte}: {gesamt.schrittText}
        </div>
      )}
      {/* ─── DIE RESTZEIT ───────────────────────────────────────────────────
          `restText` kommt fertig aus dem Kern, samt der Unterscheidung
          zwischen einer Schätzung („noch etwa") und einer Untergrenze
          („mindestens noch"). Diese Oberfläche baut sie NICHT nach — dabei
          ginge genau die Unterscheidung verloren, für die es sie gibt.

          Gibt es keinen Satz, steht das auch so da. Beim ersten Bau einer
          Karte ist das der Normalfall, und „unbekannt" ist dann die richtige
          Auskunft — nicht eine Zahl, die aus nichts entstanden ist. */}
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="gesamtbau-restzeit">
        {gesamt?.restText ??
          'Restzeit noch unbekannt — sie ergibt sich aus der Dauer des letzten Baus.'}
      </div>
      {job.note && (
        <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 break-words" data-testid="gesamtbau-notiz">
          {job.note}
        </div>
      )}
    </div>
  );
}

export default function RegionsPanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [installed, setInstalled] = useState<InstalledRegion[]>([]);
  const [catalog, setCatalog] = useState<CatalogRegion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [jobs, setJobs] = useState<Record<string, DownloadState>>({});
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
  const jobsRef = useRef<Record<string, DownloadState>>({});
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const refresh = useCallback(async () => {
    const [installedRegions, catalogRegions, laufend] = await Promise.all([
      fetchInstalledRegions(),
      fetchCatalog(),
      fetchLaufenderBau(),
    ]);
    setInstalled(installedRegions);
    setCatalog(catalogRegions);

    // ─── SICH WIEDER AN EINEN LAUFENDEN BAU HÄNGEN ────────────────────────
    // Gemeldet: „Wenn man von Yapaia woandershin wechselt und dann wieder
    // aufruft sind die aktuellen Fortschrittsinformationen vom Bau nicht mehr
    // sichtbar." — und beim nächsten Druck auf „bauen": „Es läuft bereits ein
    // Bau."
    //
    // Beides stimmte. Der Bau lief im Kern weiter; nur DIESE Zuordnung lag im
    // Speicher des Browsers und war beim Verlassen der Seite weg. Der Kern
    // wusste alles und zeigte nichts.
    //
    // Der Gesamtbau gehört dabei unter seinen eigenen Schlüssel: er baut über
    // alle Karten, und unter einer einzelnen einsortiert stünde sein
    // Fortschritt an der falschen Stelle.
    if (laufend) {
      const schluessel = laufend.bauart === 'gesamt' ? GESAMT_SCHLUESSEL : laufend.region;
      if (schluessel) {
        setJobs((prev) =>
          // Ein gerade erst hier gestarteter Job hat Vorrang — er ist
          // aktueller als das, was der Kern eine Netzrunde zuvor gemeldet hat.
          prev[schluessel] ? prev : { ...prev, [schluessel]: { jobId: laufend.id, job: laufend } },
        );
      }
    }

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
      const active = Object.entries(jobsRef.current).filter(
        ([, state]) => !state.job || (state.job.status !== 'done' && state.job.status !== 'error'),
      );
      if (active.length === 0) {
        return;
      }
      void Promise.all(
        active.map(async ([schluessel, state]) => {
          const job = await fetchJob(state.jobId);
          setJobs((prev) =>
            prev[schluessel] ? { ...prev, [schluessel]: { jobId: state.jobId, job } } : prev,
          );
          if (job && (job.status === 'done' || job.status === 'error')) {
            void refresh();
          }
        }),
      );
    }, JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOpen, refresh]);

  /**
   * Installieren ODER aktualisieren — dieselbe Handlung.
   *
   * Der Kachelbau ersetzt, was da ist; ein Download ebenso. Zwei Knöpfe
   * daraus zu machen hiesse, denselben Vorgang zweimal zu erklären.
   *
   * Welcher Weg genommen wird, entscheidet die QUELLE und nicht der Zustand:
   * gibt es eine fertige `.pmtiles`, wird sie geladen (Minuten), sonst aus dem
   * OSM-Extrakt gebaut (bei einem grossen Land Stunden).
   */
  const handleInstallieren = useCallback(async (eintrag: Karteneintrag) => {
    setErrorByRegion((prev) => ({ ...prev, [eintrag.id]: '' }));
    try {
      const jobId =
        eintrag.quelle === 'download'
          ? await startDownload(eintrag.id)
          : await startBuild(eintrag.id);
      setJobs((prev) => ({ ...prev, [eintrag.id]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError
          ? formatApiError(err)
          : 'Der Vorgang konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [eintrag.id]: message }));
    }
  }, []);

  /**
   * Der eine Knopf: Routing und Suche für ALLE Karten.
   *
   * Er ersetzt „Routing bauen" und „Suche bauen" an jedem einzelnen Eintrag.
   * Die waren nicht falsch, aber sie stellten die falsche Frage: welche
   * Erzeugnisse es gibt, statt ob danach alles passt.
   */
  const handleGesamtbau = useCallback(async () => {
    setErrorByRegion((prev) => ({ ...prev, [GESAMT_SCHLUESSEL]: '' }));
    try {
      const jobId = await startGesamtbau();
      setJobs((prev) => ({ ...prev, [GESAMT_SCHLUESSEL]: { jobId, job: null } }));
    } catch (err) {
      const message =
        err instanceof RegionApiError ? formatApiError(err) : 'Der Bau konnte nicht gestartet werden.';
      setErrorByRegion((prev) => ({ ...prev, [GESAMT_SCHLUESSEL]: message }));
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

  const karten = kartenliste(installed, catalog);
  const gesamtJob = jobs[GESAMT_SCHLUESSEL]?.job ?? null;
  // Ein laufender Vorgang — gleich welcher — sperrt jeden weiteren. Das ist
  // keine Bevormundung: zwei schwere Bauten nebeneinander teilen sich Platte
  // und Arbeitsspeicher derselben Maschine, auf der auch Home Assistant
  // laeuft. Der Kern lehnt es ohnehin mit 409 ab; die Knöpfe vorher
  // auszugrauen erspart die Fehlermeldung.
  const etwasLaeuft = Object.values(jobs).some(
    (state) => !state.job || (state.job.status !== 'done' && state.job.status !== 'error'),
  );

  return (
    <div className="fixed z-10" style={{ top: topRightSlotPx('regions'), right: TOP_RIGHT_INSET_PX }}>
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
            <BuildStatusSection />

            {/* ─── DER GEMEINSAME KNOPF ──────────────────────────────────────
                Er steht ÜBER der Liste und nicht darunter: nach einer
                Installation ist er der nächste Schritt, und was als nächstes
                zu tun ist, gehört nicht ans Ende einer Liste, die man dafür
                erst durchscrollen muss. */}
            <section className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Routing und Suche bauen</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Für alle installierten Karten gemeinsam.
                  </div>
                </div>
                <button
                  onClick={() => void handleGesamtbau()}
                  disabled={etwasLaeuft || installed.length === 0}
                  className="shrink-0 px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                  data-testid="gesamtbau-button"
                >
                  {gesamtJob && gesamtJob.status !== 'done' && gesamtJob.status !== 'error'
                    ? 'Baut…'
                    : 'Alles bauen'}
                </button>
              </div>
              {/* Nach einer Installation ist das der nächste Schritt — und
                  ohne diesen Satz weiss niemand, dass er ihn tun muss. Eine
                  frisch installierte Karte wird zwar sofort GEZEICHNET, aber
                  Routing und Suche entstehen daraus nicht von allein. */}
              {installed.length === 0 && loaded && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="gesamtbau-ohne-karte">
                  Erst eine Karte installieren — ohne Karte gibt es nichts zu bauen.
                </p>
              )}
              {gesamtJob && <GesamtFortschritt job={gesamtJob} />}
              {errorByRegion[GESAMT_SCHLUESSEL] && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid="gesamtbau-startfehler">
                  {errorByRegion[GESAMT_SCHLUESSEL]}
                </p>
              )}
            </section>

            <section>
              <h2 className="font-semibold mb-2 mt-4">Karten</h2>
              {loaded && karten.length === 0 && (
                <p className="text-slate-500 dark:text-slate-400 text-xs" data-testid="regions-installed-empty">
                  Keine Karte installiert und keine im Katalog.
                </p>
              )}
              <ul className="space-y-2">
                {karten.map((eintrag) => {
                  const state = jobs[eintrag.id];
                  const job = state?.job ?? null;
                  const laeuftHier =
                    Boolean(state) && (!job || (job.status !== 'done' && job.status !== 'error'));
                  return (
                    <li
                      key={eintrag.id}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg p-2"
                      data-testid={`karte-${eintrag.id}`}
                      data-zustand={eintrag.zustand}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{eintrag.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {istInstalliert(eintrag) ? 'Installiert · ' : ''}
                            {formatBytes(eintrag.groesseBytes)}
                            {eintrag.bounds ? ` · ${formatBounds(eintrag.bounds)}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {kannInstallieren(eintrag) && (
                            <button
                              onClick={() => void handleInstallieren(eintrag)}
                              disabled={etwasLaeuft}
                              className="px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                              data-testid={`installieren-button-${eintrag.id}`}
                            >
                              {laeuftHier ? 'Läuft…' : installierenText(eintrag)}
                            </button>
                          )}
                          {/* ─── LÖSCHEN BLEIBT IMMER ERREICHBAR ──────────
                              Bewusst OHNE `disabled={etwasLaeuft}`. Ein Bau
                              dauert Stunden und kann hängen; wäre Löschen
                              dann gesperrt, käme man an keine Karte mehr
                              heran, bis das Add-on neu startet — und ein
                              Add-on-Neustart ist genau die Art Ausweg, die
                              auf dem vorgesehenen Bedienweg niemand finden
                              soll. Dieselbe Falle hat schon einmal den Knopf
                              „Kacheln bauen" blockiert (siehe `build.ts`).

                              Wer währenddessen löscht, lässt den laufenden
                              Gesamtbau an dieser Karte scheitern. Das ist
                              laut und behebbar — anders als eine Oberfläche
                              ohne jeden Knopf. */}
                          {istInstalliert(eintrag) && (
                            <button
                              onClick={() => void handleDelete(eintrag.id)}
                              className="px-2 py-1 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs hover:bg-red-50 dark:hover:bg-red-900/30"
                              data-testid={`delete-button-${eintrag.id}`}
                            >
                              Löschen
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ─── EINE VON HAND ABGELEGTE KARTE ──────────────────
                          Sie steht in keinem Katalog, also gibt es für sie
                          keine OSM-Quelle — der gemeinsame Bau überspringt
                          sie. Das gehört gesagt: wer es nicht weiss, sucht
                          den Fehler an einer ganz anderen Stelle. */}
                      {eintrag.zustand === 'fremd' && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`karte-fremd-${eintrag.id}`}>
                          Selbst abgelegte Karte. Sie wird gezeichnet, aber Routing und Suche
                          lassen sich für sie nicht bauen — dafür fehlt die
                          OpenStreetMap-Quelle.
                        </p>
                      )}

                      {/* Ein Eintrag ohne jede Quelle bekommt keinen Knopf
                          (siehe `kannInstallieren`). Ein Knopf, der nicht
                          funktionieren KANN, ist schlimmer als keiner — er
                          schickt den Betreiber auf die Fehlersuche in seiner
                          eigenen Installation. */}
                      {eintrag.zustand === 'ohne_quelle' && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid={`karte-ohne-quelle-${eintrag.id}`}>
                          {eintrag.hinweis ?? 'Für diese Karte ist keine Quelle hinterlegt.'}
                        </p>
                      )}

                      {eintrag.zustand === 'verfuegbar' && eintrag.grosserBau && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid={`karte-grosser-bau-${eintrag.id}`}>
                          {eintrag.hinweis ??
                            'Große Region: der Kachelbau dauert auf diesem Gerät mehrere Stunden.'}
                        </p>
                      )}

                      {job && <JobProgress regionId={eintrag.id} job={job} />}
                      {errorByRegion[eintrag.id] && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid={`region-error-${eintrag.id}`}>
                          {errorByRegion[eintrag.id]}
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
        aria-label="Karten verwalten"
        aria-expanded={isOpen}
        title="Karten verwalten"
        data-testid="regions-panel-toggle"
      >
        🗺️
      </button>
    </div>
  );
}
