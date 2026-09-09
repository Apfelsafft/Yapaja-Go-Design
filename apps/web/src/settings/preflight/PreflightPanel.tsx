/**
 * Installationsprüfung in der Oberfläche (`feat/gui-install-path`).
 *
 * Adressat ist jemand, der das Add-on über die Home-Assistant-Oberfläche
 * installiert hat und ausdrücklich KEINE Shell öffnen will. Deshalb zeigt
 * diese Seite nicht nur, WAS fehlt, sondern zu jedem Punkt auch, was
 * dagegen zu tun ist — der Text dafür kommt vom Server
 * (`apps/core/src/system/preflight.ts`), damit Prüfung und Anweisung nicht
 * getrennt voneinander veralten können.
 *
 * Die Prüfung läuft NICHT automatisch beim Öffnen der App: sie öffnet
 * serverseitig TCP-Verbindungen und ist damit zu teuer für einen
 * Nebeneffekt beim Start. Sie läuft, wenn dieses Panel geöffnet wird, und
 * auf Knopfdruck erneut.
 *
 * Gleiches FAB-plus-Panel-Muster wie `RegionsPanel` (E01-T5) und
 * `StorePanel` (E09-T7); `top-52` ist der nächste freie Platz unter beiden
 * (MapLibre-NavigationControl `top-0`, RegionsPanel `top-20`, StorePanel
 * `top-36`, je 48 px hoch).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchPreflight,
  fetchTrackers,
  waehleTracker,
  type HaTracker,
  type PreflightCheck,
  type PreflightReport,
} from './client';

import { TOP_RIGHT_INSET_PX, topRightSlotPx } from '../../shell/mapControlLayout.js';
const STATUS_ICON: Record<string, string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
};

const STATUS_CLASS: Record<string, string> = {
  ok: 'text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
  warn: 'text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700',
  fail: 'text-red-700 dark:text-red-400 border-red-300 dark:border-red-700',
};

const SEVERITY_LABEL: Record<string, string> = {
  required: 'erforderlich',
  recommended: 'empfohlen',
  optional: 'optional',
};

function CheckRow({ check }: { check: PreflightCheck }): React.ReactElement {
  return (
    <li
      className={`border rounded-lg p-2 ${STATUS_CLASS[check.status] ?? ''}`}
      data-testid={`preflight-check-${check.id}`}
      data-status={check.status}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          <span aria-hidden="true">{STATUS_ICON[check.status] ?? '?'}</span> {check.label}
        </span>
        <span className="shrink-0 text-xs opacity-70">
          {SEVERITY_LABEL[check.severity] ?? check.severity}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">{check.detail}</p>
      {check.remedy && (
        <p
          className="mt-1 text-xs text-slate-600 dark:text-slate-300"
          data-testid={`preflight-remedy-${check.id}`}
        >
          <strong>Zu tun:</strong> {check.remedy}
        </p>
      )}
    </li>
  );
}

/**
 * Die Positionsquelle aus der Companion App auswaehlen (B-05).
 *
 * ─── WARUM HIER ─────────────────────────────────────────────────────────────
 * Die Installationspruefung ist die Seite, auf der steht, was der
 * Einrichtung noch fehlt. Eine Positionsquelle, die man nur ueber ein
 * Freitextfeld in der Add-on-Konfiguration einstellen kann, ist genau so ein
 * Fehlbetrag -- die Entity-ID muss man sich sonst in Home Assistant unter
 * Entwicklerwerkzeuge → Zustände zusammensuchen.
 *
 * Angezeigt wird das Feld nur, wenn Home Assistant ueberhaupt Tracker
 * meldet: eine leere Auswahl waere ein Bedienelement, das sicher nichts tut.
 */
function TrackerAuswahlFeld(): React.ReactElement | null {
  const [trackers, setTrackers] = useState<HaTracker[]>([]);
  const [gewaehlt, setGewaehlt] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    void fetchTrackers()
      .then((antwort) => {
        if (abgebrochen) return;
        setTrackers(antwort.trackers);
        setGewaehlt(antwort.selected);
      })
      .catch(() => undefined); // Eine fehlende Liste darf die Pruefung nicht stoeren.
    return () => {
      abgebrochen = true;
    };
  }, []);

  if (trackers.length === 0) return null;

  return (
    <div className="border rounded-lg p-2 border-slate-300 dark:border-slate-600" data-testid="tracker-picker">
      <label className="block text-xs font-medium" htmlFor="yapaia-tracker-select">
        Position aus der Home-Assistant-App
      </label>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        Damit läuft die Anzeige weiter, wenn Yapaia nicht offen ist. Die Wahl gilt sofort.
      </p>
      <select
        id="yapaia-tracker-select"
        data-testid="tracker-select"
        className="mt-2 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-1 text-xs"
        value={gewaehlt}
        onChange={(event) => {
          const wert = event.target.value;
          setGewaehlt(wert);
          setFehler(null);
          void waehleTracker(wert)
            .then((bestaetigt) => setGewaehlt(bestaetigt))
            .catch((err: unknown) =>
              setFehler(err instanceof Error ? err.message : 'Auswahl fehlgeschlagen.'),
            );
        }}
      >
        <option value="">— keine —</option>
        {trackers.map((tracker) => (
          <option key={tracker.entity_id} value={tracker.entity_id}>
            {tracker.friendly_name} ({tracker.entity_id})
          </option>
        ))}
      </select>
      {fehler && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid="tracker-error">
          {fehler}
        </p>
      )}
    </div>
  );
}

export default function PreflightPanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      setReport(await fetchPreflight());
    } catch (err) {
      // Auch der Fehlschlag der Prüfung selbst ist eine Aussage über die
      // Installation ("der Core antwortet nicht") und gehört sichtbar auf
      // die Seite -- nicht nur in die Browser-Konsole.
      setError(
        err instanceof Error
          ? `Die Prüfung konnte nicht ausgeführt werden: ${err.message} ` +
            'Wenn hier gar nichts ankommt, läuft der Yapaia-Dienst selbst nicht — ' +
            'sehen Sie im Home-Assistant-Add-on unter „Protokoll" nach.'
          : 'Die Prüfung konnte nicht ausgeführt werden.',
      );
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && report === null && !running) {
      void run();
    }
  }, [isOpen, report, running, run]);

  const toggleOpen = useCallback(() => setIsOpen((open) => !open), []);

  return (
    <div className="fixed z-10" style={{ top: topRightSlotPx('preflight'), right: TOP_RIGHT_INSET_PX }}>
      {isOpen && (
        <div
          className="absolute top-14 right-0 mb-2 w-96 max-h-[75vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-3"
          data-testid="preflight-panel"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Installation prüfen</h2>
            <button
              onClick={() => void run()}
              disabled={running}
              className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
              data-testid="preflight-rerun"
            >
              {running ? 'Prüfe…' : 'Erneut prüfen'}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" data-testid="preflight-error">
              {error}
            </p>
          )}

          {report && (
            <>
              <p
                className={`text-xs ${
                  report.status === 'ok'
                    ? 'text-green-700 dark:text-green-400'
                    : report.status === 'fail'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                }`}
                data-testid="preflight-summary"
                data-status={report.status}
              >
                {report.summary}
              </p>
              <ul className="space-y-2">
                {report.checks.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </ul>
              <TrackerAuswahlFeld />
              <p className="text-xs text-slate-400 dark:text-slate-500" data-testid="preflight-checked-at">
                Geprüft: {new Date(report.checkedAt).toLocaleString('de-DE')}
              </p>
            </>
          )}

          {!report && !error && running && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="preflight-loading">
              Prüfe Kacheln, Routing, Suche, Position, Speicher…
            </p>
          )}
        </div>
      )}

      <button
        onClick={toggleOpen}
        className="w-12 h-12 rounded-full bg-white/90 dark:bg-slate-800/90 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg"
        aria-label="Installation prüfen"
        aria-expanded={isOpen}
        title="Installation prüfen"
        data-testid="preflight-panel-toggle"
      >
        🩺
      </button>
    </div>
  );
}
