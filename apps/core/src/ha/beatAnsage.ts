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
  rufe: (v: HaConnection, data: Record<string, unknown>) => Promise<boolean>;
}

export class BeatAnsage implements AnsageZiel {
  constructor(private readonly deps: BeatAnsageDeps) {}

  async sage(text: string, prioritaet: AnsagePrioritaet): Promise<boolean> {
    try {
      const t = text.trim();
      const v = this.deps.verbindung();
      if (!t || !v || !this.deps.eingeschaltet()) return false;
      // Erst nachsehen, dann rufen: ohne Beat oder mit ausgeschaltetem Radio
      // wäre jeder Aufruf ein Fehler im Protokoll von Home Assistant.
      const zustand = (await this.deps.leseZustaende(v, [BEAT_ENTITAET])).get(BEAT_ENTITAET);
      if (!zustand || !LAEUFT.has(zustand)) return false;
      const { engine, language } = this.deps.stimme();
      return await this.deps.rufe(v, {
        message: t.slice(0, 1000),
        priority: prioritaet,
        ...(engine ? { engine } : {}),
        ...(language ? { language } : {}),
      });
    } catch {
      return false;
    }
  }
}

/** Einstellung `ansagen_beat`: fehlt sie, ist das Einmischen an. */
export function beatAnsagenAn(roh: unknown): boolean {
  return roh !== false;
}
