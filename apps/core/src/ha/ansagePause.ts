/* eslint-disable no-undef -- setTimeout/clearTimeout gibt es in Node. */
/**
 * Musik leiser für die Ansage: das Radio (Yapaia Beat) pausiert, solange
 * Yapaia spricht, und spielt danach weiter.
 *
 * ─── WARUM PAUSIEREN STATT „DUCKEN" ─────────────────────────────────────────
 * Yapaia Beat schickt den Radio-Stream per `media_player.play_media` an einen
 * Lautsprecher. Eine Ansage per `tts.speak` auf DENSELBEN Lautsprecher ersetzt
 * diesen Stream -- danach ist Stille, denn Yapaia Beat startet den Stream nur
 * neu, wenn sich der Ziel-Lautsprecher ändert. Ein leiseres Radio würde daran
 * nichts ändern. Was zuverlässig hilft: vor der Ansage das Radio über seine
 * eigene Entität anhalten (`media_player.media_pause`) und danach wieder
 * starten (`media_player.media_play`) -- dann schickt Yapaia Beat den Stream
 * von selbst neu an den Lautsprecher. Spielt das Radio über den Lautsprecher
 * des HA-Rechners, gilt dasselbe: Pause, Ansage, weiter.
 *
 * Nur wenn das Radio vorher lief, wird es danach wieder gestartet. Zwei
 * Ansagen kurz nacheinander teilen sich eine Pause (Zähler + Nachlauf).
 *
 * Wie alles zu Home Assistant: wirft nie. Fehlt die Entität (kein Yapaia Beat
 * installiert), passiert schlicht nichts.
 */

import type { HaConnection } from './config.js';

/** Die Entität, die die Yapaia-Beat-Integration anlegt. */
export const RADIO_ENTITAET = 'media_player.yapaia_beat';

/** Zustände, in denen das Radio Ton macht (oder gleich machen wird). */
const LAEUFT = new Set(['playing', 'buffering']);

/** Grobe Sprechdauer einer Ansage: ~14 Zeichen je Sekunde plus Anlauf. */
export function sprechdauerMs(text: string): number {
  return Math.min(30_000, 1_500 + Math.round(text.length * 70));
}

export interface AnsagePauseDeps {
  verbindung: () => HaConnection | null;
  /** Welche Entität pausiert wird; `null` = abgeschaltet. */
  entitaet: () => string | null;
  leseZustaende: (v: HaConnection, ids: readonly string[]) => Promise<Map<string, string>>;
  dienst: (v: HaConnection, dienst: 'media_pause' | 'media_play', entityId: string) => Promise<boolean>;
  warte?: (ms: number) => Promise<void>;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (h: unknown) => void;
}

export class AnsagePause {
  private offen = 0;
  /** Die Entität, die WIR angehalten haben -- nur die wird fortgesetzt. */
  private angehalten: { v: HaConnection; id: string } | null = null;
  private weiterTimer: unknown = null;
  private start: Promise<void> | null = null;

  constructor(private readonly deps: AnsagePauseDeps) {}

  private warte(ms: number): Promise<void> {
    return this.deps.warte ? this.deps.warte(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Vor der Ansage. Kehrt zurück, sobald das Radio still ist. */
  async beginne(): Promise<void> {
    this.offen += 1;
    if (this.weiterTimer !== null) {
      (this.deps.clearTimeoutImpl ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.weiterTimer);
      this.weiterTimer = null;
    }
    if (this.angehalten) return;
    if (!this.start) this.start = this.halteAn().finally(() => (this.start = null));
    await this.start;
  }

  private async halteAn(): Promise<void> {
    try {
      const v = this.deps.verbindung();
      const id = this.deps.entitaet();
      if (!v || !id) return;
      const zustand = (await this.deps.leseZustaende(v, [id])).get(id);
      if (!zustand || !LAEUFT.has(zustand)) return;
      if (!(await this.deps.dienst(v, 'media_pause', id))) return;
      this.angehalten = { v, id };
      // Yapaia Beat hält danach den Lautsprecher an -- das muss durch sein,
      // bevor die Ansage beginnt, sonst trifft das Anhalten die Ansage.
      await this.warte(1_000);
    } catch {
      // Nie werfen: dann eben Ansage über laufender Musik.
    }
  }

  /** Nach der Ansage; `nachlaufMs` = wie lange sie noch zu hören ist. */
  ende(nachlaufMs = 0): void {
    this.offen = Math.max(0, this.offen - 1);
    if (this.offen > 0 || !this.angehalten) return;
    if (this.weiterTimer !== null) {
      (this.deps.clearTimeoutImpl ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.weiterTimer);
    }
    const setT = this.deps.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.weiterTimer = setT(() => {
      this.weiterTimer = null;
      void this.setzeFort();
    }, Math.max(0, nachlaufMs));
  }

  private async setzeFort(): Promise<void> {
    const a = this.angehalten;
    if (!a || this.offen > 0) return;
    this.angehalten = null;
    try {
      await this.deps.dienst(a.v, 'media_play', a.id);
    } catch {
      // Nie werfen.
    }
  }

  dispose(): void {
    if (this.weiterTimer !== null) {
      (this.deps.clearTimeoutImpl ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.weiterTimer);
      this.weiterTimer = null;
    }
  }
}

/**
 * Aus der Einstellung `ansage_pause`: fehlt sie, gilt Yapaia Beat;
 * leer oder `"aus"` schaltet das Pausieren ab; sonst eine eigene Entität.
 */
export function ansagePauseEntitaet(roh: unknown): string | null {
  if (roh === undefined || roh === null) return RADIO_ENTITAET;
  if (typeof roh !== 'string') return RADIO_ENTITAET;
  const t = roh.trim();
  if (t === '' || t.toLowerCase() === 'aus') return null;
  return t.startsWith('media_player.') ? t : null;
}
