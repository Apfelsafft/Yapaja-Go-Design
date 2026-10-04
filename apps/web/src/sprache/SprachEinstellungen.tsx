/**
 * ⚙ → Sprache & Home Assistant: Assist-Anbindung einrichten, KI wählen.
 *
 * Gewünscht: Sprachsteuerung „per HA-Sprachsatelliten und per
 * Mikrofon-Knopf", „nach Möglichkeit mit den KI-Funktionen von Home
 * Assistant, aber gerne bei Bedarf autark".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { browserPlayer } from '../drive/ansageZiel.js';

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
  /** Die Player von Music Assistant. */
  lautsprecher?: Array<{ id: string; name: string }>;
  /** Gewählter Lautsprecher für Ansagen, '' = automatisch. */
  lautsprecherWahl?: string;
  /** Gong vor Ansagen über Music Assistant. */
  ansageGong?: boolean;
  /** Läuft das Radio über Music Assistant: wo die Verzögerung hin soll. */
  ansageMaWeg?: 'browser' | 'mischen' | 'sofort';
  /** Music Assistant als Integration eingerichtet? null = unbekannt. */
  musicAssistant?: boolean | null;
  /** Welchen Weg eine Ansage gerade nähme. */
  ansageWeg?: { art: 'lautsprecher' | 'beat-ma' | 'beat-ma-browser' | 'beat' | 'selbst'; ziel?: string; radioLaeuft?: boolean };
}

/** In Klartext: wie eine Ansage gerade ankommt. */
export function wegText(w: NonNullable<Stand['ansageWeg']>): string {
  switch (w.art) {
    case 'lautsprecher':
      return `Über Music Assistant an „${w.ziel ?? '?'}“ – ohne Verzögerung.`;
    case 'beat-ma-browser':
      return `Yapaia Beat spielt über Music Assistant auf „${w.ziel ?? '?'}“. Ist das dieser Browser, mischt er die Ansage sofort selbst ein; sonst mischt Beat sie ins Radio.`;
    case 'beat-ma':
      return `Yapaia Beat spielt über Music Assistant auf „${w.ziel ?? '?'}“ und mischt die Ansage ins Radio – die Musik läuft dabei leiser weiter.`;
    case 'beat':
      return w.radioLaeuft
        ? 'Yapaia Beat mischt die Ansage ins Radio (einige Sekunden verzögert).'
        : 'Yapaia spricht selbst – läuft das Radio von Yapaia Beat, mischt Beat die Ansage ein.';
    default:
      return 'Yapaia spricht selbst.';
  }
}

/** Warum es (k)einen Player von Music Assistant gibt. */
export function maText(s: Stand): string {
  const n = s.lautsprecher?.length ?? 0;
  if (n > 0) return `Music Assistant: ${n === 1 ? 'ein Player' : `${n} Player`} gefunden.`;
  if (s.musicAssistant) {
    return 'Music Assistant ist eingerichtet, gibt aber keinen Player an Home Assistant weiter. In Music Assistant: Einstellungen → Wiedergabegeräte → Player wählen → „Dieses Wiedergabegerät für Home Assistant freigeben“ einschalten und speichern.';
  }
  return 'Music Assistant ist in Home Assistant nicht als Integration eingerichtet (Einstellungen → Geräte & Dienste). Das Add-on allein reicht nicht.';
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

  // Nach einer Änderung oder einem Test: den Weg der Ansagen neu holen, ohne
  // dass die Seite kurz „lädt".
  const stillNeu = async (): Promise<void> => {
    try {
      const r = await fetch(url('api/v1/sprache/ha'));
      const body = (await r.json()) as { data?: Stand };
      if (body.data) setStand(body.data);
    } catch {
      // bleibt beim alten Stand
    }
  };

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
    // Ist dieser Browser Beats Player bei Music Assistant, wird hier
    // eingemischt -- genau wie bei einer Abbiege-Ansage.
    const player = browserPlayer();
    if (player) {
      try {
        const beginn = performance.now();
        const r = await fetch(url('api/v1/ansage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Das ist eine Testansage von Yapaia.', prioritaet: 'hinweis', browser_player: player.name }),
        });
        const d = ((await r.json()) as { data?: { im_browser?: { pfad?: string }; ueber_radio?: boolean } }).data;
        if (d?.im_browser?.pfad) {
          const ok = await player.sprich(`${window.location.origin}${d.im_browser.pfad}`);
          const s = ((performance.now() - beginn) / 1000).toFixed(1).replace('.', ',');
          setTest(
            ok
              ? { ok: true, grund: `Im Browser eingemischt („${player.name}“) – nach ${s} s gesprochen, die Musik lief leiser weiter.` }
              : { ok: false, grund: 'Der Browser konnte die Ansage nicht abspielen (einmal irgendwo tippen und erneut testen).' },
          );
          void stillNeu();
          return;
        }
        if (d?.ueber_radio) {
          setTest({ ok: true, grund: 'Yapaia Beat hat die Ansage ins Radio gemischt.' });
          void stillNeu();
          return;
        }
      } catch {
        // dann der Weg über den Kern
      }
    }
    try {
      const r = await fetch(url('api/v1/ansage/test'), { method: 'POST' });
      const body = (await r.json()) as { data?: { ok: boolean; grund: string } };
      setTest(body.data ?? { ok: false, grund: `HTTP ${r.status}` });
    } catch {
      setTest({ ok: false, grund: 'Yapaia ist nicht erreichbar.' });
    }
    void stillNeu();
  };

  const lautsprecherSetzen = async (id: string): Promise<void> => {
    setStand((s) => (s ? { ...s, lautsprecherWahl: id } : s));
    try {
      await fetch(url('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ansage_lautsprecher: id || null }),
      });
      void stillNeu();
    } catch {
      // Beim nächsten Öffnen zeigt der Stand vom Kern, was gilt.
    }
  };

  const maWegSetzen = async (weg: 'browser' | 'mischen' | 'sofort'): Promise<void> => {
    setStand((s) => (s ? { ...s, ansageMaWeg: weg } : s));
    try {
      await fetch(url('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ansage_ma_weg: weg }),
      });
      void stillNeu();
    } catch {
      // Beim nächsten Öffnen zeigt der Stand vom Kern, was gilt.
    }
  };

  const gongSetzen = async (an: boolean): Promise<void> => {
    setStand((s) => (s ? { ...s, ansageGong: an } : s));
    try {
      await fetch(url('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ansage_gong: an }),
      });
    } catch {
      // Beim nächsten Öffnen zeigt der Stand vom Kern, was gilt.
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
      void stillNeu();
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
        <label className="block space-y-1">
          <span>Ansagen über</span>
          <select
            value={stand?.lautsprecherWahl ?? ''}
            onChange={(e) => void lautsprecherSetzen(e.target.value)}
            disabled={!stand?.verfuegbar}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-700"
            data-testid="sprach-lautsprecher"
          >
            <option value="">Automatisch</option>
            {(stand?.lautsprecher ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (Music Assistant)
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Läuft das Radio von Yapaia Beat, mischt Beat die Ansage ein – auch wenn es über Music Assistant spielt; die
            Musik läuft dabei leiser weiter. Sonst geht sie an den gewählten Player (Automatisch: an Music Assistant,
            wenn es genau einen Player gibt); Music Assistant hält dafür kurz an, was dort läuft. Sonst spricht
            Yapaia selbst.
          </span>
        </label>
        <label className="block space-y-1">
          <span>Läuft das Radio über Music Assistant</span>
          <select
            value={stand?.ansageMaWeg ?? 'browser'}
            onChange={(e) => void maWegSetzen(e.target.value as 'browser' | 'mischen' | 'sofort')}
            disabled={!stand?.verfuegbar}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-700"
            data-testid="sprach-ma-weg"
          >
            <option value="browser">Im Browser einmischen – sofort, Musik läuft leiser weiter</option>
            <option value="mischen">Beat mischt – Musik läuft weiter, Ansage einige Sekunden später</option>
            <option value="sofort">Music Assistant spricht sofort – Musik pausiert, kommt später wieder</option>
          </select>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            „Im Browser einmischen“ geht, wenn dieser Browser in Yapaia Beat als „Music Assistant in diesem Browser“
            angemeldet ist und das Radio darauf spielt (Yapaia Beat 1.9). Sonst mischt Beat.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={stand?.ansageGong ?? true}
            onChange={(e) => void gongSetzen(e.target.checked)}
            disabled={!stand?.verfuegbar}
            className="mt-1 h-4 w-4"
            data-testid="sprach-ansage-gong"
          />
          <span>
            Gong vor Ansagen über Music Assistant. Mischt Yapaia Beat die Ansage ins Radio, gibt es keinen Gong.
          </span>
        </label>
        {stand?.verfuegbar && (
          <div className="space-y-1 rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-700/60" data-testid="sprach-ansage-weg">
            <p>
              <span className="font-medium">So kommen Ansagen gerade an: </span>
              {wegText(stand.ansageWeg ?? { art: 'selbst' })}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="sprach-ma-stand">
              {maText(stand)}
            </p>
          </div>
        )}
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
