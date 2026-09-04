/**
 * „Was ist gebaut?" — die Übersicht über Kacheln, Routing und Suche.
 *
 * ─── WARUM ROUTING UND SUCHE HIER NICHT PRO REGION STEHEN ───────────────────
 * Kacheln liegen pro Region nebeneinander. Routinggraph und Suchindex gibt es
 * dagegen nur EINMAL: beide Bauwege ersetzen den vorherigen Stand vollständig.
 * Wer Routing für Rheinland-Pfalz baut, hat danach kein Routing mehr für
 * Liechtenstein.
 *
 * Die Knöpfe stehen aber pro Region und legen das Gegenteil nahe. Deshalb
 * nennt diese Übersicht ausdrücklich die Region, aus der der eine Graph und
 * der eine Index stammen — statt pro Region ein Häkchen zu zeigen, das für
 * jede andere gelogen wäre.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { fetchBuildStatus, formatBuiltAt, type BuildStatus, type ArtifactStatus } from './buildStatus.js';

function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Eine Zeile: was, woraus, wann. */
function ArtifactRow({
  icon,
  title,
  status,
  testId,
  regions,
}: {
  icon: string;
  title: string;
  status: ArtifactStatus;
  testId: string;
  /** Alle Regionen, die in diesem einen Erzeugnis stecken. */
  regions?: string[];
}): React.ReactElement {
  const when = formatBuiltAt(status.built_at);
  return (
    <li className="flex items-start gap-2" data-testid={testId}>
      <span aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="font-medium">{title}</span>
        {!status.present ? (
          <span className="block text-slate-500 dark:text-slate-400">noch nicht gebaut</span>
        ) : (
          <>
            <span className="block text-slate-600 dark:text-slate-300">
              {(regions && regions.length > 0 ? regions[0] : status.region) ?? 'Region unbekannt'}
              {when ? ` · ${when}` : ''}
            </span>
            {(status.record_count !== undefined || status.size_bytes !== undefined) && (
              <span className="block text-slate-500 dark:text-slate-400">
                {[
                  status.record_count !== undefined
                    ? `${status.record_count.toLocaleString('de-DE')} Einträge`
                    : null,
                  formatBytes(status.size_bytes),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            {regions && regions.length > 1 && (
              <span className="block text-slate-500 dark:text-slate-400">
                enthält: {regions.join(', ')}
              </span>
            )}
          </>
        )}
      </span>
    </li>
  );
}

export default function BuildStatusSection(): React.ReactElement | null {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    void fetchBuildStatus(signal)
      .then((next) => {
        setStatus(next);
        setFailed(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (failed || !status) {
    return null;
  }

  const nothingBuilt =
    status.tiles.length === 0 && !status.routing.present && status.search.length === 0;

  return (
    <section data-testid="build-status">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Was ist gebaut?</h2>
        <button
          type="button"
          onClick={() => load()}
          className="text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="build-status-refresh"
        >
          Aktualisieren
        </button>
      </div>

      {nothingBuilt ? (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="build-status-empty">
          Noch nichts gebaut.
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          <li data-testid="build-status-tiles">
            <span className="font-medium">🗺️ Karten</span>
            {status.tiles.length === 0 ? (
              <span className="block text-slate-500 dark:text-slate-400 ml-6">
                noch nicht gebaut
              </span>
            ) : (
              <ul className="ml-6 space-y-0.5">
                {status.tiles.map((tile) => {
                  const when = formatBuiltAt(tile.built_at);
                  return (
                    <li
                      key={tile.region}
                      className="text-slate-600 dark:text-slate-300"
                      data-testid={`build-status-tile-${tile.region}`}
                    >
                      {tile.region}
                      {when ? ` · ${when}` : ''}
                      {formatBytes(tile.size_bytes) ? ` · ${formatBytes(tile.size_bytes)}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>

          {/* Routing: EIN Graph, aber seit 0.5.0 ueber mehrere Laender
              gebaut. Das ist absichtlich so -- nur wer beide Seiten einer
              Grenze im selben Graphen hat, kann ueber sie hinweg routen. */}
          <ArtifactRow
            icon="🧭"
            title="Routing"
            status={status.routing}
            testId="build-status-routing"
            regions={status.routing.regions}
          />

          <li data-testid="build-status-search">
            <span className="font-medium">🔎 Suche</span>
            {status.search.length === 0 ? (
              <span className="block text-slate-500 dark:text-slate-400 ml-6">
                noch nicht gebaut
              </span>
            ) : (
              <ul className="ml-6 space-y-0.5">
                {status.search.map((index, i) => {
                  const when = formatBuiltAt(index.built_at);
                  return (
                    <li
                      key={index.region ?? `index-${i}`}
                      className="text-slate-600 dark:text-slate-300"
                      data-testid={`build-status-search-${index.region ?? 'unbekannt'}`}
                    >
                      {index.region ?? 'Region unbekannt'}
                      {when ? ` · ${when}` : ''}
                      {index.record_count !== undefined
                        ? ` · ${index.record_count.toLocaleString('de-DE')} Einträge`
                        : ''}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        </ul>
      )}
    </section>
  );
}
