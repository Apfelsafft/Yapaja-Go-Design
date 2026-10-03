/**
 * ⚙ → Sprache & Home Assistant: Assist-Anbindung einrichten, KI wählen.
 *
 * Gewünscht: Sprachsteuerung „per HA-Sprachsatelliten und per
 * Mikrofon-Knopf", „nach Möglichkeit mit den KI-Funktionen von Home
 * Assistant, aber gerne bei Bedarf autark".
 */

import React, { useCallback, useEffect, useState } from 'react';

interface Stand {
  verfuegbar: boolean;
  helfer: boolean;
  automation: boolean;
  agent: string | null;
  agenten: Array<{ id: string; name: string }>;
  /** Ansagen ins laufende Radio (Yapaia Beat) einmischen. */
  ansagenBeat?: boolean;
  /** Gibt es Yapaia Beat in Home Assistant? */
  radio?: boolean;
}

interface Ergebnis {
  helfer: boolean;
  automation: boolean;
  hinweis?: string;
}

const url = (pfad: string): string => `${import.meta.env.BASE_URL}${pfad}`;

export default function SprachEinstellungen(): React.ReactElement {
  const [stand, setStand] = useState<Stand | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [richtetEin, setRichtetEin] = useState(false);

  const laden = useCallback(async () => {
    setLaedt(true);
    try {
      const r = await fetch(url('api/v1/sprache/ha'));
      const body = (await r.json()) as { data?: Stand };
      setStand(body.data ?? null);
    } catch {
      setStand(null);
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const einrichten = async (): Promise<void> => {
    setRichtetEin(true);
    setErgebnis(null);
    try {
      const r = await fetch(url('api/v1/sprache/ha/einrichten'), { method: 'POST' });
      const body = (await r.json()) as { data?: Ergebnis; error?: { message: string } };
      setErgebnis(body.data ?? { helfer: false, automation: false, hinweis: body.error?.message ?? `HTTP ${r.status}` });
    } catch {
      setErgebnis({ helfer: false, automation: false, hinweis: 'Yapaia ist nicht erreichbar.' });
    } finally {
      setRichtetEin(false);
      void laden();
    }
  };

  const agentWaehlen = async (agent: string): Promise<void> => {
    setStand((s) => (s ? { ...s, agent: agent || null } : s));
    try {
      await fetch(url('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprache_agent: agent || null }),
      });
    } catch {
      // Beim nächsten Öffnen zeigt der Stand vom Kern, was gilt.
    }
  };

  const [test, setTest] = useState<{ ok: boolean; grund: string } | 'laeuft' | null>(null);
  const testen = async (): Promise<void> => {
    setTest('laeuft');
    try {
      const r = await fetch(url('api/v1/ansage/test'), { method: 'POST' });
      const body = (await r.json()) as { data?: { ok: boolean; grund: string } };
      setTest(body.data ?? { ok: false, grund: `HTTP ${r.status}` });
    } catch {
      setTest({ ok: false, grund: 'Yapaia ist nicht erreichbar.' });
    }
  };

  const ansagenBeatSetzen = async (an: boolean): Promise<void> => {
    setStand((s) => (s ? { ...s, ansagenBeat: an } : s));
    try {
      await fetch(url('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ansagen_beat: an }),
      });
    } catch {
      // Beim nächsten Öffnen zeigt der Stand vom Kern, was gilt.
    }
  };

  return (
    <div className="space-y-5 text-sm text-slate-800 dark:text-slate-100" data-testid="sprach-einstellungen">
      <section className="space-y-2">
        <h3 className="font-semibold">Sprechen über Home Assistant Assist</h3>
        <p className="text-slate-600 dark:text-slate-300">
          Sprachsatelliten und der Assist-Knopf der Home-Assistant-App hören auch ohne HTTPS zu. Yapaia legt dafür in
          Home Assistant einen Helfer und die Automation „Yapaia Sprachbefehle" an.
        </p>
        {laedt && <p className="text-slate-500">Lade …</p>}
        {!laedt && stand && !stand.verfuegbar && (
          <p className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="sprach-ha-nicht-verfuegbar">
            Nur im Home-Assistant-Add-on verfügbar.
          </p>
        )}
        {!laedt && stand?.verfuegbar && (
          <ul className="space-y-1" data-testid="sprach-ha-stand">
            <li>{stand.helfer ? '✅' : '⬜'} Helfer „Yapaia Sprachbefehl"</li>
            <li>{stand.automation ? '✅' : '⬜'} Automation „Yapaia Sprachbefehle"</li>
          </ul>
        )}
        <button
          type="button"
          onClick={() => void einrichten()}
          disabled={richtetEin || !stand?.verfuegbar}
          className="w-full rounded-full bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-testid="sprach-ha-einrichten"
        >
          {richtetEin ? 'Richte ein …' : stand?.automation ? 'Neu einrichten' : 'In Home Assistant einrichten'}
        </button>
        {ergebnis && (
          <p
            className={ergebnis.automation ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}
            data-testid="sprach-ha-ergebnis"
          >
            {ergebnis.automation && ergebnis.helfer
              ? 'Eingerichtet. Sag zum Beispiel „Yapaia, fahre mich nach Magdeburg".'
              : (ergebnis.hinweis ?? 'Das hat nicht geklappt.')}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">So sprichst du mit Yapaia</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
          <li>Satellit: Aktivierungswort, dann z. B. „Yapaia, wo ist die nächste Tankstelle?"</li>
          <li>Home-Assistant-App: Assist öffnen (Mikrofon), dann den Befehl sprechen.</li>
          <li>Häufige Befehle gehen auch ohne „Yapaia": „Fahre mich nach …", „Stoppe die Navigation", „Wann sind wir da?"</li>
          <li>
            Nutzt dein Assist eine KI als Gesprächsagent, schalte dort „Befehle bevorzugt lokal verarbeiten" ein — sonst
            erreichen die Sätze Yapaia nicht.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Ansagen und Radio</h3>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={stand?.ansagenBeat ?? true}
            onChange={(e) => void ansagenBeatSetzen(e.target.checked)}
            disabled={!stand}
            className="mt-1 h-4 w-4"
            data-testid="sprach-ansagen-beat"
          />
          <span>
            Läuft Yapaia Beat, Ansagen ins Radio einmischen: die Musik wird leiser, die Ansage kommt darüber, danach
            wird die Musik wieder lauter. Braucht Yapaia Beat 1.6.
            {stand?.verfuegbar && !stand.radio && (
              <span className="block text-xs text-slate-500">Yapaia Beat ist in Home Assistant nicht eingerichtet.</span>
            )}
          </span>
        </label>
        <button
          type="button"
          onClick={() => void testen()}
          disabled={test === 'laeuft'}
          className="w-full rounded-full border border-slate-300 px-4 py-2 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
          data-testid="sprach-ansage-test"
        >
          {test === 'laeuft' ? 'Teste …' : 'Ansage ins Radio testen'}
        </button>
        {test && test !== 'laeuft' && (
          <p
            className={test.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}
            data-testid="sprach-ansage-test-ergebnis"
          >
            {test.ok ? '✅ ' : '⚠️ '}
            {test.grund}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">KI für freie Sätze</h3>
        <p className="text-slate-600 dark:text-slate-300">
          Versteht Yapaia einen Satz nicht, kann es eine KI aus Home Assistant fragen. Die übersetzt nur — ausgeführt wird
          weiterhin von Yapaia, und eine Route startet erst nach „Ja". Ohne KI funktionieren alle eingebauten Befehle,
          auch offline.
        </p>
        <select
          value={stand?.agent ?? ''}
          onChange={(e) => void agentWaehlen(e.target.value)}
          disabled={!stand?.verfuegbar}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-700"
          data-testid="sprach-agent"
        >
          <option value="">Keine KI (nur eingebaute Befehle)</option>
          {(stand?.agenten ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {stand?.verfuegbar && stand.agenten.length === 0 && (
          <p className="text-xs text-slate-500">In Home Assistant ist kein Gesprächsagent eingerichtet.</p>
        )}
      </section>
    </div>
  );
}
