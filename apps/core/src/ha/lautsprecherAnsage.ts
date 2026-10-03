/* eslint-disable no-undef -- `setTimeout`/`AbortController` sind Standard-Globale in Node 22. */
/**
 * Ansagen über einen Lautsprecher von Music Assistant.
 *
 * Gewünscht -- vier Ausbaustufen, je nachdem, was installiert ist:
 *   1. nur Go:                       Go spricht selbst (Browser oder HA-TTS)
 *   2. Go + Yapaia Beat:             Beat mischt die Ansage ins Radio
 *   3. Go + Music Assistant:         die Ansage geht an Music Assistant
 *   4. Go + Beat + Music Assistant:  Radio und Ansage laufen gemeinsam über
 *                                    Music Assistant, die Ansage hat Vorrang
 *
 * Stufe 4 erledigt Beat (ab 1.7): spielt sein Radio auf einem
 * Music-Assistant-Player, gibt es Go-Ansagen dorthin weiter. Dieses Modul
 * ist Stufe 3 -- und die ausdrückliche Wahl eines Lautsprechers in den
 * Einstellungen, die immer gilt.
 *
 * Music Assistant macht aus `tts.speak` eine Ansage: läuft Musik, wird sie
 * kurz pausiert und danach fortgesetzt; Snapcast und Sonos mischen sie
 * stattdessen leiser darunter.
 *
 * Wirft nie.
 */

import type { HaConnection } from './config.js';
import type { HaEntityState, HaFetchLike } from './client.js';
import { defaultHaFetch } from './client.js';
import { BEAT_ENTITAET, type AnsagePrioritaet, type AnsageZiel, type Pruefergebnis, type RufErgebnis } from './beatAnsage.js';
import { wsBefehl, type WsBefehlDeps } from './wsBefehl.js';

/** Woran ein Player von Music Assistant zu erkennen ist. */
export const MA_ATTRIBUT = 'mass_player_type';

export interface Lautsprecher {
  id: string;
  name: string;
}

/** Die Player von Music Assistant (erreichbar), nach Namen sortiert. */
export function maLautsprecher(zustaende: readonly HaEntityState[]): Lautsprecher[] {
  return zustaende
    .filter((z) => z.entity_id.startsWith('media_player.') && MA_ATTRIBUT in (z.attributes ?? {}) && z.state !== 'unavailable')
    .map((z) => ({ id: z.entity_id, name: String(z.attributes.friendly_name ?? z.entity_id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Welcher Lautsprecher die Ansage bekommt -- oder keiner.
 *
 * Eingestellt (`ansage_lautsprecher`) gilt immer. Sonst automatisch: gibt es
 * Yapaia Beat, ist es dessen Sache (Stufe 2 oder 4); ohne Beat genau dann,
 * wenn es GENAU EINEN Music-Assistant-Player gibt -- bei mehreren wäre es
 * geraten, welcher im Fahrzeug steht.
 */
export function lautsprecherWahl(
  einstellung: unknown,
  zustaende: readonly HaEntityState[],
  beatVorhanden: boolean,
): string | null {
  if (typeof einstellung === 'string' && einstellung.startsWith('media_player.')) return einstellung;
  if (beatVorhanden) return null;
  const ma = maLautsprecher(zustaende);
  return ma.length === 1 ? ma[0]!.id : null;
}

/**
 * Welchen Weg eine Ansage gerade nähme -- für die Anzeige in den
 * Einstellungen. Gewünscht: man soll sehen, ob es über Music Assistant geht.
 *
 * - `lautsprecher`: Go schickt sie selbst an einen Player von Music Assistant
 * - `beat-ma`:      Beat spielt auf einem Player von Music Assistant und
 *                   gibt die Ansage dorthin weiter (ab Beat 1.7)
 * - `beat`:         Beat mischt sie ins Radio (nur, solange es läuft)
 * - `selbst`:       Go spricht selbst
 */
export interface AnsageWeg {
  art: 'lautsprecher' | 'beat-ma' | 'beat' | 'selbst';
  /** Name des Players von Music Assistant. */
  ziel?: string;
  /** Bei `beat`: läuft das Radio gerade? Sonst spricht Go selbst. */
  radioLaeuft?: boolean;
}

export function ansageWeg(einstellung: unknown, zustaende: readonly HaEntityState[], beatAn: boolean): AnsageWeg {
  const name = (id: string): string => {
    const z = zustaende.find((x) => x.entity_id === id);
    return String(z?.attributes?.friendly_name ?? id);
  };
  const beat = zustaende.find((z) => z.entity_id === BEAT_ENTITAET);
  const wahl = lautsprecherWahl(einstellung, zustaende, beat !== undefined);
  if (wahl) return { art: 'lautsprecher', ziel: name(wahl) };
  if (beat && beatAn) {
    const radioLaeuft = beat.state === 'playing' || beat.state === 'buffering';
    const speaker = beat.attributes?.speaker;
    if (radioLaeuft && typeof speaker === 'string' && maLautsprecher(zustaende).some((l) => l.id === speaker)) {
      return { art: 'beat-ma', ziel: name(speaker) };
    }
    return { art: 'beat', radioLaeuft };
  }
  return { art: 'selbst' };
}

/** Ist Music Assistant als Integration in Home Assistant eingerichtet? Null = unbekannt. */
export async function maEingerichtet(v: HaConnection, fetch: HaFetchLike = defaultHaFetch): Promise<boolean | null> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), 5_000);
  try {
    const r = await fetch(`${v.apiBase}/config`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
      signal: abbruch.signal,
    });
    const cfg = r.ok && r.json ? ((await r.json()) as { components?: unknown }) : null;
    return Array.isArray(cfg?.components) ? cfg.components.includes('music_assistant') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

export interface Stimme {
  engine: string;
  language?: string;
}

/**
 * Stimme und Sprache für `tts.speak`. Eingestellt (HA-TTS in Go) gilt; sonst
 * fragt Home Assistant selbst, welche Stimme die Sprache des Systems spricht
 * und in welcher genauen Schreibweise (`tts/engine/list`, z. B. „de-DE" für
 * die Cloud, „de" für Google Translate). Ohne Sprache läse die Stimme
 * deutschen Text mit englischem Akzent.
 */
export async function findeStimme(
  v: HaConnection,
  wunsch: { engine?: string; language?: string },
  deps: { fetch?: HaFetchLike; ws?: WsBefehlDeps } = {},
): Promise<Stimme | null> {
  // Auch eine eingestellte Sprache wird nachgeschlagen: „de" kennt etwa die
  // Cloud-Stimme nicht, nur „de-DE" -- und `tts.speak` lehnt dann ab.
  let sprache = wunsch.language;
  if (!sprache) {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), 5_000);
    try {
      const r = await (deps.fetch ?? defaultHaFetch)(`${v.apiBase}/config`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
        signal: abbruch.signal,
      });
      const cfg = r.ok && r.json ? ((await r.json()) as { language?: unknown }) : null;
      if (typeof cfg?.language === 'string') sprache = cfg.language;
    } catch {
      // ohne Systemsprache: die Stimme nimmt ihre eigene
    } finally {
      clearTimeout(uhr);
    }
  }
  const liste = (await wsBefehl(v, { type: 'tts/engine/list', ...(sprache ? { language: sprache } : {}) }, deps.ws)) as {
    providers?: Array<{ engine_id?: unknown; supported_languages?: unknown }>;
  } | null;
  const anbieter = (liste?.providers ?? []).filter(
    (p): p is { engine_id: string; supported_languages?: unknown } => typeof p.engine_id === 'string',
  );
  if (wunsch.engine && !anbieter.some((p) => p.engine_id === wunsch.engine)) {
    // Die gewählte Stimme taucht nicht auf (spricht die Sprache nicht, oder
    // die Liste fehlt): so nehmen, wie eingestellt.
    return { engine: wunsch.engine, ...(wunsch.language ? { language: wunsch.language } : {}) };
  }
  const passend =
    anbieter.find((p) => p.engine_id === wunsch.engine) ??
    anbieter.find((p) => Array.isArray(p.supported_languages) && p.supported_languages.length > 0) ??
    anbieter[0];
  if (!passend) return wunsch.engine ? { engine: wunsch.engine } : null;
  const sprachen = Array.isArray(passend.supported_languages) ? (passend.supported_languages as unknown[]) : [];
  const genau = sprachen.find((s): s is string => typeof s === 'string');
  return { engine: passend.engine_id, ...(genau ? { language: genau } : sprache ? { language: sprache } : {}) };
}

export interface LautsprecherAnsageDeps {
  verbindung: () => HaConnection | null;
  /** Der Lautsprecher für diese Ansage (`lautsprecherWahl`), oder null. */
  ziel: (v: HaConnection) => Promise<string | null>;
  stimme: (v: HaConnection) => Promise<Stimme | null>;
  /** `tts.speak` aufrufen. */
  rufe: (v: HaConnection, data: Record<string, unknown>) => Promise<RufErgebnis>;
}

export class LautsprecherAnsage implements AnsageZiel {
  constructor(private readonly deps: LautsprecherAnsageDeps) {}

  async sage(text: string, _prioritaet: AnsagePrioritaet): Promise<boolean> {
    return (await this.versuche(text)).ok;
  }

  /** `zustaendig: false` -- kein Lautsprecher gewählt, die Kette fragt weiter. */
  async versuche(text: string): Promise<Pruefergebnis & { zustaendig: boolean }> {
    try {
      const v = this.deps.verbindung();
      if (!v || !text.trim()) return { ok: false, zustaendig: false, grund: 'Keine Verbindung zu Home Assistant.' };
      const ziel = await this.deps.ziel(v);
      if (!ziel) return { ok: false, zustaendig: false, grund: 'Kein Lautsprecher für Ansagen gewählt.' };
      const stimme = await this.deps.stimme(v);
      if (!stimme) {
        return { ok: false, zustaendig: true, grund: 'In Home Assistant ist keine Sprachausgabe (TTS) eingerichtet.' };
      }
      const r = await this.deps.rufe(v, {
        entity_id: stimme.engine,
        media_player_entity_id: ziel,
        message: text.trim().slice(0, 1000),
        ...(stimme.language ? { language: stimme.language } : {}),
      });
      const stimmeText = `${stimme.engine}${stimme.language ? `, ${stimme.language}` : ''}`;
      return r.ok
        ? { ok: true, zustaendig: true, grund: `Die Ansage ging an ${ziel} (Music Assistant, Stimme ${stimmeText}).` }
        : {
            ok: false,
            zustaendig: true,
            // Gewünscht: sagen, WARUM -- Home Assistant nennt den Grund.
            grund:
              `${ziel} hat die Ansage nicht angenommen (Stimme ${stimmeText})` +
              (r.fehler ? `: ${r.fehler}` : r.status ? ` (HTTP ${r.status}).` : '.'),
          };
    } catch {
      return { ok: false, zustaendig: true, grund: 'Home Assistant hat nicht geantwortet.' };
    }
  }

  async pruefe(text = 'Das ist eine Testansage von Yapaia.'): Promise<Pruefergebnis & { zustaendig: boolean }> {
    return this.versuche(text);
  }
}

/**
 * Erst der Lautsprecher (Stufe 3 bzw. ausdrückliche Wahl), dann Beat
 * (Stufe 2 und 4); wer nicht übernimmt, lässt den nächsten. Übernimmt
 * keiner, spricht Go selbst (Stufe 1).
 */
export class AnsageKette implements AnsageZiel {
  constructor(
    private readonly lautsprecher: LautsprecherAnsage,
    private readonly beat: AnsageZiel & { pruefe(text?: string): Promise<Pruefergebnis> },
  ) {}

  async sage(text: string, prioritaet: AnsagePrioritaet): Promise<boolean> {
    // Klappt es am gewählten Lautsprecher nicht, lieber Beat oder Go selbst
    // als gar keine Ansage.
    if ((await this.lautsprecher.versuche(text)).ok) return true;
    return this.beat.sage(text, prioritaet);
  }

  async pruefe(text?: string): Promise<Pruefergebnis> {
    const l = await this.lautsprecher.pruefe(text);
    if (l.zustaendig) return { ok: l.ok, grund: l.grund };
    return this.beat.pruefe(text);
  }
}
