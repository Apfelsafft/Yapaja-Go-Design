/* eslint-disable no-undef -- `setInterval`/`clearInterval` sind Standard-Globale
 * in Node 22; dieselbe Begruendung wie in ha/client.ts. */

/**
 * Sprachbefehle ueber Home Assistant Assist (0.30).
 *
 * ─── WARUM UEBER HOME ASSISTANT ─────────────────────────────────────────────
 * Browser geben das Mikrofon nur ueber HTTPS frei; der Betreiber ruft Home
 * Assistant ueber `http://…:8123` auf. Home Assistant selbst hoert aber zu:
 * ueber Sprach-Satelliten und ueber den Assist-Knopf der Home-Assistant-App --
 * ohne HTTPS. Gewuenscht war genau das: „per HA-Sprachsatelliten und per
 * Mikrofon-Knopf".
 *
 * ─── DER WEG EINES SATZES ───────────────────────────────────────────────────
 *   1. Assist erkennt „Yapaia, fahre mich nach Magdeburg" (Satz-Ausloeser
 *      einer Automation, die Yapaia selbst anlegt: `automationKonfig`).
 *   2. Die Automation schreibt „<Zeitstempel>|<Satz>" in
 *      `input_text.yapaia_sprachbefehl` und wartet auf die Antwort.
 *   3. Diese Bruecke sieht die Aenderung (jede Sekunde), gibt den Satz an
 *      denselben Sprachdialog wie der 🎤-Knopf der App
 *      (`sprache/dialog.ts`) und schreibt die Antwort nach
 *      `sensor.yapaia_sprachantwort`.
 *   4. Die Automation liest sie und laesst Assist sie sprechen.
 *
 * Der Zeitstempel vorne ist kein Schmuck: sagt man zweimal „ja", bliebe der
 * Text gleich -- und ein unveraenderter Zustand loest nichts aus.
 *
 * Alles ohne YAML: Helfer per WebSocket, Automation ueber die
 * Konfigurations-Schnittstelle. Der Betreiber bedient Home Assistant nur
 * ueber die Oberflaeche.
 */

import type { HaConnection } from './config.js';
import { legeHelferAn, type HelferSoll, type WsDeps } from './commandHelpers.js';
import { defaultHaFetch, type HaFetchLike } from './client.js';

export const SPRACH_EINGABE = 'input_text.yapaia_sprachbefehl';
export const SPRACH_ANTWORT = 'sensor.yapaia_sprachantwort';
export const AUTOMATION_ID = 'yapaia_sprachbefehle';

export const SPRACH_HELFER: HelferSoll = {
  entityId: SPRACH_EINGABE,
  typ: 'input_text',
  name: 'Yapaia Sprachbefehl',
  icon: 'mdi:microphone-message',
  befehl: 'sprache',
};

/**
 * Die Saetze, auf die Home Assistant hoert.
 *
 * „Yapaia" in den Schreibweisen, die Spracherkennungen tatsaechlich liefern;
 * dazu die haeufigsten Befehle OHNE Anrede, damit „Okay Nabu, wo ist die
 * naechste Tankstelle?" auch ohne das Wort Yapaia funktioniert.
 */
export const SAETZE: readonly string[] = [
  'Yapaia {befehl}',
  'Yapaja {befehl}',
  'Japaja {befehl}',
  'Japaia {befehl}',
  'Ja Paja {befehl}',
  'Navi {befehl}',
  'fahre mich {befehl}',
  'fahr mich {befehl}',
  'bring mich {befehl}',
  'bring uns {befehl}',
  'navigiere {befehl}',
  'wo ist die nächste {befehl}',
  'wo ist der nächste {befehl}',
  'wo ist das nächste {befehl}',
  'stoppe die navigation',
  'navigation stoppen',
  'navigation beenden',
  'pausiere die navigation',
  'navigation fortsetzen',
  'wann sind wir da',
  'wie lange noch',
  'lies die verkehrsmeldungen vor',
];

export function automationKonfig(): Record<string, unknown> {
  return {
    alias: 'Yapaia Sprachbefehle',
    description:
      'Von Yapaia Go angelegt. Leitet gesprochene Navigationsbefehle an Yapaia weiter und spricht die Antwort. ' +
      'Neu anlegen: in Yapaia unter ⚙ → Sprache & Home Assistant.',
    triggers: [{ trigger: 'conversation', command: [...SAETZE] }],
    conditions: [],
    actions: [
      {
        action: 'input_text.set_value',
        target: { entity_id: SPRACH_EINGABE },
        data: { value: '{{ now().timestamp() | int }}|{{ trigger.sentence[:230] }}' },
      },
      {
        wait_for_trigger: [{ trigger: 'state', entity_id: SPRACH_ANTWORT }],
        timeout: '00:00:25',
        continue_on_timeout: true,
      },
      {
        set_conversation_response:
          "{{ state_attr('" + SPRACH_ANTWORT + "', 'antwort') if wait.trigger else 'Yapaia antwortet gerade nicht.' }}",
      },
    ],
    mode: 'queued',
    max: 5,
  };
}

/** „1727890000|fahre mich nach Magdeburg" → Schlüssel und Satz. */
export function leseEingabe(wert: string | undefined): { schluessel: string; text: string } | null {
  if (!wert || wert === 'unknown' || wert === 'unavailable') return null;
  const i = wert.indexOf('|');
  if (i <= 0) return wert.trim() ? { schluessel: wert, text: wert.trim() } : null;
  const text = wert.slice(i + 1).trim();
  return text ? { schluessel: wert, text } : null;
}

export interface SprachBrueckeDeps {
  verbindung: () => HaConnection | null;
  leseZustaende: (v: HaConnection, ids: readonly string[]) => Promise<Map<string, string>>;
  schreibeZustand: (
    v: HaConnection,
    entityId: string,
    body: { state: string; attributes?: Record<string, unknown> },
  ) => Promise<boolean>;
  verarbeite: (text: string) => Promise<{ antwort: string; rueckfrage?: boolean; absicht: string }>;
  ws: WsDeps;
  fetch?: HaFetchLike;
  logger: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
  intervallMs?: number;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (h: unknown) => void;
}

export interface EinrichtErgebnis {
  helfer: boolean;
  automation: boolean;
  /** Was nicht geklappt hat, in Klartext. */
  hinweis?: string;
}

export class HaSprachBruecke {
  private zuletzt: string | undefined;
  private erster = true;
  private laeuft = false;
  private zaehler = 0;
  private timer: unknown;
  private helferVersucht = false;

  constructor(private readonly deps: SprachBrueckeDeps) {
    const setI = deps.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = setI(() => void this.takt(), deps.intervallMs ?? 1_000);
  }

  /** Ein Durchgang. Wirft nie. */
  async takt(): Promise<void> {
    if (this.laeuft) return;
    const v = this.deps.verbindung();
    if (!v) return;
    this.laeuft = true;
    try {
      let zustaende: Map<string, string>;
      try {
        zustaende = await this.deps.leseZustaende(v, [SPRACH_EINGABE]);
      } catch {
        return;
      }
      const wert = zustaende.get(SPRACH_EINGABE);
      if (wert === undefined) {
        // Den Helfer gibt es noch nicht: einmal je Lauf anlegen. Die
        // Automation legt erst der Knopf in den Einstellungen an -- sie
        // veraendert, worauf Assist hoert, und das soll man wollen.
        if (!this.helferVersucht) {
          this.helferVersucht = true;
          await legeHelferAn(v, [SPRACH_HELFER], {}, this.deps.ws);
        }
        return;
      }
      // Der erste gelesene Wert ist nur die Grundlinie (wie bei den
      // Bedien-Helfern): ein Neustart darf keinen alten Satz noch einmal
      // ausfuehren.
      if (this.erster) {
        this.erster = false;
        this.zuletzt = wert;
        return;
      }
      if (wert === this.zuletzt) return;
      this.zuletzt = wert;
      const eingabe = leseEingabe(wert);
      if (!eingabe) return;

      const antwort = await this.deps.verarbeite(eingabe.text);
      this.zaehler += 1;
      await this.deps.schreibeZustand(v, SPRACH_ANTWORT, {
        state: `${Date.now()}-${this.zaehler}`,
        attributes: {
          friendly_name: 'Yapaia Antwort',
          icon: 'mdi:message-text',
          antwort: antwort.antwort,
          frage: eingabe.text,
          absicht: antwort.absicht,
          rueckfrage: Boolean(antwort.rueckfrage),
        },
      });
      this.deps.logger.info('Sprachbefehl aus Home Assistant', { frage: eingabe.text, absicht: antwort.absicht });
    } finally {
      this.laeuft = false;
    }
  }

  /**
   * Helfer und Automation anlegen (Knopf in den Einstellungen).
   * Die Automation wird überschrieben, falls es sie schon gibt -- so kommt
   * eine neue Satzliste mit einem Klick an.
   */
  async einrichten(): Promise<EinrichtErgebnis> {
    const v = this.deps.verbindung();
    if (!v) {
      return { helfer: false, automation: false, hinweis: 'Keine Verbindung zu Home Assistant (nur im Add-on verfügbar).' };
    }
    const vorhanden = await this.deps.leseZustaende(v, [SPRACH_EINGABE]).catch(() => new Map<string, string>());
    let helfer = vorhanden.has(SPRACH_EINGABE);
    if (!helfer) helfer = (await legeHelferAn(v, [SPRACH_HELFER], {}, this.deps.ws)).length > 0;

    const fetchImpl = this.deps.fetch ?? defaultHaFetch;
    const controller = new AbortController();
    const uhr = setTimeout(() => controller.abort(), 10_000);
    let automation = false;
    let hinweis: string | undefined;
    try {
      const res = await fetchImpl(`${v.apiBase}/config/automation/config/${AUTOMATION_ID}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(automationKonfig()),
        signal: controller.signal,
      });
      automation = res.ok;
      if (!res.ok) {
        hinweis =
          res.status === 401 || res.status === 403
            ? 'Home Assistant erlaubt Yapaia nicht, Automationen anzulegen.'
            : `Home Assistant lehnte die Automation ab (HTTP ${res.status}).`;
      }
    } catch (err) {
      hinweis = `Home Assistant nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(uhr);
    }
    if (!helfer && !hinweis) hinweis = 'Der Helfer „Yapaia Sprachbefehl" ließ sich nicht anlegen.';
    this.deps.logger.info('Sprachsteuerung in Home Assistant eingerichtet', { helfer, automation, hinweis });
    return { helfer, automation, ...(hinweis ? { hinweis } : {}) };
  }

  dispose(): void {
    const clearI = this.deps.clearIntervalImpl ?? ((h) => clearInterval(h as never));
    if (this.timer !== undefined) clearI(this.timer);
    this.timer = undefined;
  }
}
