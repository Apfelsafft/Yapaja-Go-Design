/* eslint-disable no-undef -- `AbortController`/`setTimeout` sind Standard-Globale
 * in Node 22; dieselbe Begruendung wie in ha/client.ts. */

/**
 * Ansagen ins Radio einmischen (Yapaia Beat).
 *
 * Gemeldet: „Toll wäre, wenn es für die Ansage die aktuelle Musik
 * unterbricht und danach die Musik wieder hörbar ist." Der erste Versuch
 * (0.31) hielt das Radio an und startete es wieder -- es blieb aber stumm.
 * Jetzt mischt Yapaia Beat die Ansage selbst ein: Musik leiser, Ansage
 * darüber, Musik wieder lauter. Nichts wird gestoppt, der Lautsprecher
 * bekommt einen durchgehenden Stream (`yapaia_beat.announce`, Beat 1.6).
 *
 * ─── DAS ÖKOSYSTEM ──────────────────────────────────────────────────────────
 * Go kennt nur ein {@link AnsageZiel}: „kann gerade jemand Ansagen
 * einmischen?". Heute ist das Beat; ein weiteres Ziel (Music Assistant, ein
 * eigener Yapaia-Lautsprecher) wird später nur danebengestellt. Sagt das
 * Ziel nein, spricht Go wie bisher selbst (HA-TTS oder Browser).
 *
 * Wirft nie.
 */

import type { HaConnection } from './config.js';
import { defaultHaFetch, type HaFetchLike } from './client.js';

/** Die Entität und die Aktion der Yapaia-Beat-Integration. */
export const BEAT_ENTITAET = 'media_player.yapaia_beat';
export const BEAT_AKTION = { domain: 'yapaia_beat', service: 'announce' } as const;

/** Zustände, in denen Beat Ton macht (oder gleich machen wird). */
const LAEUFT = new Set(['playing', 'buffering']);

export type AnsagePrioritaet = 'navigation' | 'hinweis' | 'info';

export interface AnsageZiel {
  /** `true`, wenn die Ansage übernommen wurde -- sonst spricht Go selbst. */
  sage(text: string, prioritaet: AnsagePrioritaet): Promise<boolean>;
}

export interface BeatAnsageDeps {
  verbindung: () => HaConnection | null;
  /** Einstellung „Ansagen ins Radio einmischen". */
  eingeschaltet: () => boolean;
  /** Stimme und Sprache, wie für `tts.speak` eingestellt (beides optional). */
  stimme: () => { engine?: string; language?: string };
  leseZustaende: (v: HaConnection, ids: readonly string[]) => Promise<Map<string, string>>;
  rufe: (v: HaConnection, data: Record<string, unknown>) => Promise<RufErgebnis>;
  /** Gibt es die Aktion `yapaia_beat.announce` (Beat ≥ 1.6, HA neu gestartet)? `null` = unbekannt. */
  aktionVorhanden?: (v: HaConnection) => Promise<boolean | null>;
}

export interface RufErgebnis {
  ok: boolean;
  /** HTTP-Status von Home Assistant, wenn es einen gab. */
  status?: number;
}

/** Das Ergebnis von „Ansage ins Radio testen" -- in Klartext. */
export interface Pruefergebnis {
  ok: boolean;
  grund: string;
}

export class BeatAnsage implements AnsageZiel {
  constructor(private readonly deps: BeatAnsageDeps) {}

  async sage(text: string, prioritaet: AnsagePrioritaet): Promise<boolean> {
    return (await this.versuche(text, prioritaet, false)).ok;
  }

  /**
   * „Ansage ins Radio testen": spricht wirklich und sagt in Klartext, warum
   * es nicht geht. Gemeldet: die Antwort kam aus dem Browser statt aus dem
   * Radio -- und von außen war nicht zu sehen, weshalb Beat nicht übernahm.
   */
  async pruefe(text = 'Das ist eine Testansage von Yapaia.'): Promise<Pruefergebnis> {
    return this.versuche(text, 'hinweis', true);
  }

  private async versuche(text: string, prioritaet: AnsagePrioritaet, genau: boolean): Promise<Pruefergebnis> {
    try {
      const t = text.trim();
      const v = this.deps.verbindung();
      if (!t) return { ok: false, grund: 'Kein Text.' };
      if (!v) return { ok: false, grund: 'Keine Verbindung zu Home Assistant.' };
      if (!this.deps.eingeschaltet()) return { ok: false, grund: 'Ansagen ins Radio sind ausgeschaltet.' };
      // Erst nachsehen, dann rufen: ohne Beat oder mit ausgeschaltetem Radio
      // wäre jeder Aufruf ein Fehler im Protokoll von Home Assistant.
      const zustand = (await this.deps.leseZustaende(v, [BEAT_ENTITAET])).get(BEAT_ENTITAET);
      if (!zustand) {
        return { ok: false, grund: 'Yapaia Beat ist in Home Assistant nicht eingerichtet (media_player.yapaia_beat fehlt).' };
      }
      if (!LAEUFT.has(zustand)) return { ok: false, grund: 'Yapaia Beat spielt gerade nicht.' };
      if (genau && this.deps.aktionVorhanden && (await this.deps.aktionVorhanden(v)) === false) {
        return {
          ok: false,
          grund: 'Die Aktion yapaia_beat.announce fehlt: Yapaia Beat auf 1.6 oder neuer aktualisieren und Home Assistant neu starten.',
        };
      }
      const { engine, language } = this.deps.stimme();
      const r = await this.deps.rufe(v, {
        message: t.slice(0, 1000),
        priority: prioritaet,
        ...(engine ? { engine } : {}),
        ...(language ? { language } : {}),
      });
      if (r.ok) return { ok: true, grund: 'Yapaia Beat hat die Ansage ins Radio gemischt.' };
      if (r.status === 400) {
        return { ok: false, grund: 'Home Assistant kennt die Aktion yapaia_beat.announce nicht: Home Assistant neu starten.' };
      }
      return {
        ok: false,
        grund:
          'Yapaia Beat konnte die Ansage nicht sprechen' +
          (r.status ? ` (HTTP ${r.status})` : '') +
          '. Häufigster Grund: in Home Assistant ist keine Sprachausgabe (TTS) eingerichtet. Details stehen im Protokoll von Home Assistant.',
      };
    } catch {
      return { ok: false, grund: 'Home Assistant hat nicht geantwortet.' };
    }
  }
}

async function haAnfrage(
  v: HaConnection,
  pfad: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  deps: { fetch?: HaFetchLike; timeoutMs?: number },
): Promise<{ status: number; ok: boolean; json?: unknown }> {
  const controller = new AbortController();
  const uhr = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  try {
    const res = await (deps.fetch ?? defaultHaFetch)(`${v.apiBase}${pfad}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const json = init.method === 'GET' && res.ok && res.json ? await res.json() : undefined;
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(uhr);
  }
}

/** `yapaia_beat.announce` aufrufen. Wirft nie. */
export async function rufeBeat(
  v: HaConnection,
  data: Record<string, unknown>,
  deps: { fetch?: HaFetchLike; timeoutMs?: number } = {},
): Promise<RufErgebnis> {
  try {
    // Die Sprache erzeugen dauert, bei Cloud-Stimmen auch mal Sekunden.
    const r = await haAnfrage(v, `/services/${BEAT_AKTION.domain}/${BEAT_AKTION.service}`, { method: 'POST', body: data }, {
      timeoutMs: 10_000,
      ...deps,
    });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false };
  }
}

/** Steht `yapaia_beat.announce` in der Liste der Aktionen? Wirft nie. */
export async function beatAktionVorhanden(
  v: HaConnection,
  deps: { fetch?: HaFetchLike; timeoutMs?: number } = {},
): Promise<boolean | null> {
  try {
    const r = await haAnfrage(v, '/services', { method: 'GET' }, deps);
    if (!r.ok || !Array.isArray(r.json)) return null;
    const beat = (r.json as Array<{ domain?: string; services?: Record<string, unknown> }>).find(
      (d) => d.domain === BEAT_AKTION.domain,
    );
    return Boolean(beat?.services && BEAT_AKTION.service in beat.services);
  } catch {
    return null;
  }
}

/** Einstellung `ansagen_beat`: fehlt sie, ist das Einmischen an. */
export function beatAnsagenAn(roh: unknown): boolean {
  return roh !== false;
}
