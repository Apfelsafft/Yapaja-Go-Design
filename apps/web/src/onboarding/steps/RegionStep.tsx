/**
 * Onboarding step 3: region select + download, with a real RAM/disk-check
 * display (E08-T5, W-12/W-18). Reuses the EXISTING region-manager client
 * (`settings/regions/client.ts`, same `POST /api/v1/map/regions` W-18
 * disk-pre-check the standalone RegionsPanel drives) rather than
 * reimplementing region download -- this is just a wizard-shaped UI on top
 * of it. Skippable (first skippable step, task: "überspringbar ab Schritt
 * 3").
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCatalog,
  fetchInstalledRegions,
  fetchJob,
  startDownload,
  RegionApiError,
  type CatalogRegion,
  type InstalledRegion,
  type JobSnapshot,
} from '../../settings/regions/client.js';
import { fetchSystemResources } from '../client.js';
import { recommendPhotonOff, LOW_DISK_THRESHOLD_BYTES, type SystemResources } from '../resourceRecommendation.js';

const JOB_POLL_INTERVAL_MS = 400;

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatApiError(err: RegionApiError): string {
  if (err.code === 'INSUFFICIENT_SPACE') {
    const required =
      typeof err.details?.requiredBytes === 'number' ? formatBytes(err.details.requiredBytes) : 'unbekannt';
    const free = typeof err.details?.freeBytes === 'number' ? formatBytes(err.details.freeBytes) : 'unbekannt';
    return `Nicht genug freier Speicherplatz: benötigt ${required}, verfügbar ${free}.`;
  }
  if (err.code === 'ALREADY_INSTALLED') return 'Diese Region ist bereits installiert.';
  return err.message || 'Unbekannter Fehler.';
}

export default function RegionStep(): React.ReactElement {
  const [installed, setInstalled] = useState<InstalledRegion[]>([]);
  const [catalog, setCatalog] = useState<CatalogRegion[]>([]);
  const [resources, setResources] = useState<SystemResources | null>(null);
  const [downloads, setDownloads] = useState<Record<string, { jobId: string; job: JobSnapshot | null }>>({});
  const [errorByRegion, setErrorByRegion] = useState<Record<string, string>>({});

  const downloadsRef = useRef(downloads);
  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  const refresh = useCallback(async () => {
    const [installedRegions, catalogRegions, sysResources] = await Promise.all([
      fetchInstalledRegions(),
      fetchCatalog(),
      fetchSystemResources(),
    ]);
    setInstalled(installedRegions);
    setCatalog(catalogRegions);
    setResources(sysResources);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      const active = Object.entries(downloadsRef.current).filter(
        ([, s]) => !s.job || (s.job.status !== 'done' && s.job.status !== 'error'),
      );
      if (active.length === 0) return;
      void Promise.all(
        active.map(async ([regionId, s]) => {
          const job = await fetchJob(s.jobId);
          setDownloads((prev) => (prev[regionId] ? { ...prev, [regionId]: { jobId: s.jobId, job } } : prev));
          if (job && (job.status === 'done' || job.status === 'error')) {
            void refresh();
          }
        }),
      );
    }, JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

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

  const downloadableCatalog = catalog.filter((entry) => !entry.installed);
  const photonOffRecommended = resources ? recommendPhotonOff(resources) : false;

  return (
    <div className="space-y-4" data-testid="onboarding-step-region">
      {resources && (
        <div
          className="rounded-md border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1"
          data-testid="onboarding-resources-display"
        >
          <p>
            Freier Speicherplatz:{' '}
            <span data-testid="onboarding-disk-free" className="font-medium">
              {formatBytes(resources.disk_free_bytes)}
            </span>{' '}
            von {formatBytes(resources.disk_total_bytes)}
          </p>
          <p>
            Freier Arbeitsspeicher:{' '}
            <span data-testid="onboarding-mem-free" className="font-medium">
              {formatBytes(resources.mem_free_bytes)}
            </span>{' '}
            von {formatBytes(resources.mem_total_bytes)}
          </p>
          {photonOffRecommended && (
            <p
              className="text-amber-700 dark:text-amber-400 font-medium pt-1"
              data-testid="onboarding-photon-off-recommendation"
            >
              Weniger als {formatBytes(LOW_DISK_THRESHOLD_BYTES)} frei: Wir empfehlen, den
              Online-Suchdienst „Photon“ in den Einstellungen zu deaktivieren, um Arbeitsspeicher
              zu sparen.
            </p>
          )}
        </div>
      )}

      <section>
        <h3 className="font-semibold mb-2">Installierte Regionen</h3>
        {installed.length === 0 && (
          <p className="text-slate-500 dark:text-slate-400 text-xs" data-testid="onboarding-regions-installed-empty">
            Noch keine Karte installiert.
          </p>
        )}
        <ul className="space-y-2">
          {installed.map((region) => (
            <li
              key={region.region}
              className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs"
              data-testid={`onboarding-installed-region-${region.region}`}
            >
              {region.region} · {formatBytes(region.size_bytes)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Verfügbare Regionen</h3>
        <ul className="space-y-2">
          {downloadableCatalog.map((entry) => {
            const download = downloads[entry.id];
            const job = download?.job;
            const isActive = !!download && (!job || (job.status !== 'done' && job.status !== 'error'));
            return (
              <li
                key={entry.id}
                className="border border-slate-200 dark:border-slate-700 rounded-lg p-2"
                data-testid={`onboarding-catalog-region-${entry.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <div className="font-medium">{entry.name}</div>
                    <div className="text-slate-500 dark:text-slate-400">{formatBytes(entry.sizeBytes)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDownload(entry.id)}
                    disabled={isActive}
                    className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs disabled:opacity-50"
                    data-testid={`onboarding-download-button-${entry.id}`}
                  >
                    Herunterladen
                  </button>
                </div>
                {job && (
                  <div className="mt-1" data-testid={`onboarding-download-progress-${entry.id}`}>
                    <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-[width]"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {job.status === 'error'
                        ? `Fehler: ${job.error?.message ?? 'Download fehlgeschlagen'}`
                        : job.status === 'done'
                          ? 'Fertig'
                          : `${Math.round(job.progress * 100)}%`}
                    </div>
                  </div>
                )}
                {errorByRegion[entry.id] && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid={`onboarding-region-error-${entry.id}`}>
                    {errorByRegion[entry.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
