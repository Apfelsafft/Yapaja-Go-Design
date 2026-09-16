/**
 * Der Knopf für die Online-Prüfung — und was sie geantwortet hat.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gefragt: „Online Dienste habe ich enabled aber wie führe ich nun deine
 * Prüfung aus? Ich sehe den Knopf nicht."
 *
 * Es gab ihn nicht. 0.10.0 hat die Prüfung gebaut, aber nur als Schnittstelle
 * — und der Betreiber hat ausdrücklich gesagt, dass er alles aus der
 * Oberfläche heraus machen möchte und nicht über SSH. Eine Funktion, die nur
 * über einen Endpunkt erreichbar ist, gibt es für ihn also nicht.
 *
 * ─── WARUM SIE HIER STEHT UND NICHT IM KARTENMENÜ ───────────────────────────
 * Weil sie eine Diagnose ist und daneben schon die Installationsprüfung
 * steht. Wer wissen will, ob etwas funktioniert, schaut an EINER Stelle nach.
 *
 * ─── WAS SIE ANZEIGT ────────────────────────────────────────────────────────
 * Je Dienst eine Zeile mit der gerufenen Adresse, dem Statuscode und dem
 * Befund im Klartext. Die Adresse ist anklickbar: der kürzeste Weg von
 * „Yapaia sagt X" zu „stimmt X?" ist, sie selbst im Browser zu öffnen.
 *
 * Die Prüfung ruft nach draußen. Deshalb passiert sie NUR auf Knopfdruck,
 * nie beim Öffnen der Klappe.
 */

import React, { useCallback, useState } from 'react';
import {
  fetchOnlineStatus,
  starteDiagnose,
  type DiagnoseZeile,
  type OnlineStatus,
} from './client.js';

function StatusMarke({ zeile }: { zeile: DiagnoseZeile }): React.ReactElement {
  const gut = zeile.status !== null && zeile.status >= 200 && zeile.status < 300;
  const farbe = gut
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-amber-600 dark:text-amber-400';
  return (
    <span className={`font-mono text-xs ${farbe}`}>
      {zeile.status === null ? 'keine Antwort' : zeile.status}
    </span>
  );
}

export default function OnlineDiagnose(): React.ReactElement {
  const [status, setStatus] = useState<OnlineStatus | null>(null);
  const [zeilen, setZeilen] = useState<DiagnoseZeile[] | null>(null);
  const [urteil, setUrteil] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  // Der Status kostet nichts und ruft NICHT nach draussen -- er darf also
  // beim Öffnen geholt werden. Die Prüfung selbst nicht.
  React.useEffect(() => {
    void fetchOnlineStatus().then(setStatus);
  }, []);

  const pruefen = useCallback(async () => {
    setLaeuft(true);
    setFehler(null);
    const ergebnis = await starteDiagnose();
    setLaeuft(false);
    if ('fehler' in ergebnis) {
      setFehler(ergebnis.fehler);
      setZeilen(null);
      setUrteil(null);
      return;
    }
    setZeilen(ergebnis.zeilen);
    setUrteil(ergebnis.urteil);
  }, []);

  return (
    <section className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700" data-testid="online-diagnose">
      <h3 className="font-semibold text-sm mb-1">🌐 Online-Dienste</h3>

      {status !== null && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2" data-testid="online-hinweis">
          {status.hinweis}
        </p>
      )}

      <button
        onClick={() => void pruefen()}
        disabled={laeuft || status?.aktiv === false}
        data-testid="online-diagnose-start"
        className="px-3 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500"
      >
        {laeuft ? 'Prüfe…' : 'Online-Dienste prüfen'}
      </button>

      {fehler !== null && (
        <p
          className="mt-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="online-diagnose-fehler"
        >
          {fehler}
        </p>
      )}

      {urteil !== null && (
        <p className="mt-2 text-xs font-medium" data-testid="online-diagnose-urteil">
          {urteil}
        </p>
      )}

      {zeilen !== null && (
        <ul className="mt-2 space-y-2" data-testid="online-diagnose-zeilen">
          {zeilen.map((z) => (
            <li key={z.url} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{z.dienst}</span>
                <StatusMarke zeile={z} />
              </div>
              <p className="text-slate-600 dark:text-slate-300">{z.befund}</p>
              {/* Anklickbar, damit man selbst nachsehen kann, statt zu
                  glauben. `noreferrer` -- die fremde Seite muss nicht
                  wissen, woher der Klick kam. */}
              <a
                href={z.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-600 dark:text-blue-400 break-all underline"
              >
                {z.url}
              </a>
              {z.beispiel && (
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Beispiel: „{z.beispiel.titel}"
                  {z.beispiel.lat !== null && z.beispiel.lon !== null
                    ? ` (${z.beispiel.lat.toFixed(4)}, ${z.beispiel.lon.toFixed(4)})`
                    : ' — ohne Koordinaten'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
