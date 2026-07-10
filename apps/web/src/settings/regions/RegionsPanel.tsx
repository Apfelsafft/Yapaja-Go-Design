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
import {
  deleteRegion,
  fetchCatalog,
  fetchInstalledRegions,
  fetchJob,
  startDownload,
  RegionApiError,
  type CatalogRegion,
  type InstalledRegion,
  type JobSnapshot,
} from './client';

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
  return err.message || 'Unbekannter Fehler.';
}

interface DownloadState {
  jobId: string;
  job: JobSnapshot | null;
}

export default function RegionsPanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [installed, setInstalled] = useState<InstalledRegion[]>([]);
  const [catalog, setCatalog] = useState<CatalogRegion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [errorByRegion, setErrorByRegion] = useState<Record<string, string>>({});

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
    <div className="fixed top-20 right-4 z-10">
      {isOpen && (
        <div
          className="absolute top-14 right-0 mb-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4"
          data-testid="regions-panel"
        >
          <section>
            <h2 className="font-semibold mb-2">Installierte Regionen</h2>
            {installed.length === 0 && (
              <p
                className="text-slate-500 dark:text-slate-400 text-xs"
                data-testid="regions-installed-empty"
              >
                Keine Karte installiert.
              </p>
            )}
            <ul className="space-y-2">
              {installed.map((region) => (
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
                    <button
                      onClick={() => void handleDelete(region.region)}
                      className="shrink-0 px-2 py-1 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs hover:bg-red-50 dark:hover:bg-red-900/30"
                      data-testid={`delete-button-${region.region}`}
                    >
                      Löschen
                    </button>
                  </div>
                  {errorByRegion[region.region] && (
                    <p
                      className="mt-1 text-xs text-red-600 dark:text-red-400"
                      data-testid={`region-error-${region.region}`}
                    >
                      {errorByRegion[region.region]}
                    </p>
                  )}
                </li>
              ))}
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
                      <button
                        onClick={() => void handleDownload(entry.id)}
                        disabled={isActive}
                        className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                        data-testid={`download-button-${entry.id}`}
                      >
                        Herunterladen
                      </button>
                    </div>
                    {job && job.status !== 'done' && (
                      <div className="mt-1" data-testid={`download-progress-${entry.id}`}>
                        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-[width]"
                            style={{ width: `${Math.round(job.progress * 100)}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {job.status === 'error'
                            ? `Fehler: ${job.error?.message ?? 'Download fehlgeschlagen'}`
                            : `${Math.round(job.progress * 100)}%`}
                        </div>
                      </div>
                    )}
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
