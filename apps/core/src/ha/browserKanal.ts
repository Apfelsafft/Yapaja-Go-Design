/* eslint-disable no-undef -- `setTimeout` ist Standard-Global in Node 22. */
/**
 * Ansagen an den Browser, auf dem das Radio spielt -- auch die, die nicht die
 * App selbst auslöst (Antworten der Sprachsteuerung über Home Assistant
 * Assist, die Ansage über den HA-Kanal).
 *
 * Gewünscht: „Schau bitte mal nach, ob alle Sprachausgaben denselben Weg
 * nehmen." Die Abbiege-Ansage der App mischte der Browser schon selbst ein
 * (0.38, sofort); die Antworten der Sprachsteuerung gingen noch über Beat in
 * den Stream -- mit dem Vorrat von Music Assistant, also Sekunden später.
 *
 * Der Browser meldet sich regelmäßig, solange Beats Player dort spielt
 * (`POST /api/v1/ansage/browser`). Dann schickt der Kern ihm die Sprache über
 * den Bus (`ansage/browser`, WebSocket) und wartet kurz auf die Bestätigung;
 * kommt keine, mischt Beat wie bisher. Ohne angemeldeten Browser wird nicht
 * gewartet.
 */

import type { AnsagePrioritaet, AnsageZiel } from './beatAnsage.js';

/** So lange gilt eine Anmeldung des Browsers. */
export const ANMELDUNG_MS = 15_000;
/** So lange wartet der Kern auf die Bestätigung des Browsers. */
export const BESTAETIGUNG_MS = 2_000;

export interface BrowserKanalDeps {
  /** Darf jetzt ein Browser einmischen (Modus „browser", Beat spielt über Music Assistant)? */
  darf: () => Promise<boolean>;
  /** Die Sprache als Datei bei Home Assistant. */
  pfad: (text: string) => Promise<string | null>;
  /** An die Browser schicken (Bus-Thema `ansage/browser`). */
  sende: (nachricht: { id: string; pfad: string }) => void;
  jetzt?: () => number;
}

export class BrowserKanal implements AnsageZiel {
  private angemeldet: { name: string; bis: number } | null = null;
  private wartend = new Map<string, (ok: boolean) => void>();
  private zaehler = 0;

  constructor(private readonly deps: BrowserKanalDeps) {}

  private jetzt(): number {
    return this.deps.jetzt ? this.deps.jetzt() : Date.now();
  }

  /** Der Browser meldet sich: Beats Player spielt dort. */
  melde(name: string): void {
    this.angemeldet = { name, bis: this.jetzt() + ANMELDUNG_MS };
  }

  /** Ein Browser hat übernommen (oder nicht). */
  bestaetige(id: string, ok: boolean): void {
    this.wartend.get(id)?.(ok);
  }

  get aktiv(): boolean {
    return !!this.angemeldet && this.angemeldet.bis > this.jetzt();
  }

  async sage(text: string, _prioritaet: AnsagePrioritaet): Promise<boolean> {
    try {
      if (!this.aktiv || !text.trim() || !(await this.deps.darf())) return false;
      const pfad = await this.deps.pfad(text);
      if (!pfad) return false;
      const id = `a${++this.zaehler}-${this.jetzt()}`;
      const antwort = new Promise<boolean>((fertig) => {
        const uhr = setTimeout(() => fertig(false), BESTAETIGUNG_MS);
        this.wartend.set(id, (ok) => {
          clearTimeout(uhr);
          fertig(ok);
        });
      });
      this.deps.sende({ id, pfad });
      const ok = await antwort;
      this.wartend.delete(id);
      return ok;
    } catch {
      return false;
    }
  }
}
