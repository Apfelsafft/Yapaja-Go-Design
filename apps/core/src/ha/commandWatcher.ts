/* eslint-disable no-undef -- `setInterval`/`clearInterval` sind Standard-Globale
 * in Node 22; dieselbe Begruendung wie in ha/client.ts. */

/**
 * Beobachtet die Bedien-Helfer und fuehrt aus, was gedrueckt wurde.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * „Sofern technisch ueberhaupt moeglich soll alles funktionieren." Ohne
 * MQTT-Broker gab es bisher keine bedienbaren Entitaeten. `commandHelpers.ts`
 * legt sie an; diese Datei macht sie wirksam.
 *
 * ─── WARUM GEFRAGT UND NICHT ZUGEHOERT ──────────────────────────────────────
 * Home Assistant koennte die Zustandswechsel ueber eine dauerhafte
 * WebSocket-Verbindung schicken. Das waere sparsamer -- und braechte alles
 * mit, was an einer Dauerverbindung haengt: Wiederverbinden mit Ruecknahme,
 * halboffene Leitungen, verlorene Ereignisse waehrend eines Aussetzers. Vier
 * Zustaende im Sekundentakt abzufragen kostet Home Assistant nichts
 * Messbares und hat keinen dieser Faelle.
 *
 * ─── DIE REIHENFOLGE IST WICHTIG ────────────────────────────────────────────
 * Erst lesen, dann vergleichen, dann ausfuehren. Und der ERSTE gelesene Wert
 * loest nie etwas aus: der Zustand eines `input_button` ist der Zeitpunkt des
 * letzten Drucks, auch wenn der von gestern ist. Ohne diese Regel beendete
 * jeder Neustart des Add-ons die laufende Fahrt (siehe `erkenneBefehle`).
 */

import type { HaConnection } from './config.js';
import { HELFER, erkenneBefehle, fehlendeHelfer, legeHelferAn, type WsDeps } from './commandHelpers.js';

/** Wie oft die Helfer gelesen werden. */
export const BEFEHLS_INTERVALL_MS = 1_000;

/** Nur die Navigationsbefehle, die dieser Beobachter ausloest. */
export interface NavigationBefehle {
  pause(): void;
  resume(): void;
  stop(): void;
}

/** Nur die Profiloperationen, die gebraucht werden. */
export interface ProfilBefehle {
  getAll(): Array<{ id: string; name: string }>;
  activate(id: string): unknown;
}

export interface CommandWatcherDeps {
  verbindung: () => HaConnection | null;
  /** Ob MQTT die Bedienung bereits liefert -- dann haelt sich dieser Weg zurueck. */
  mqttLiefert: () => boolean;
  /** Liest die Zustaende der genannten Entitaeten; fehlende fehlen im Ergebnis. */
  leseZustaende: (
    verbindung: HaConnection,
    entityIds: readonly string[],
  ) => Promise<Map<string, string>>;
  navigation: NavigationBefehle;
  profile: ProfilBefehle;
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
  ws: WsDeps;
  intervallMs?: number;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}

export class HaCommandWatcher {
  private readonly deps: CommandWatcherDeps;
  private zuletzt = new Map<string, string>();
  private timer: unknown = null;
  private entsorgt = false;
  private anlegenLaeuft = false;
  private angelegtVersucht = false;

  constructor(deps: CommandWatcherDeps) {
    this.deps = deps;
    const setIntervalFn = deps.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = setIntervalFn(() => {
      void this.takt();
    }, deps.intervallMs ?? BEFEHLS_INTERVALL_MS);
  }

  /** Ein Durchgang. Wirft nie. */
  async takt(): Promise<void> {
    if (this.entsorgt) return;
    const verbindung = this.deps.verbindung();
    if (!verbindung) return;
    // Mit MQTT gibt es die Schaltflaechen bereits als vollwertige Entitaeten;
    // ein zweiter Satz Knoepfe fuer dieselbe Sache waere nur Verwirrung.
    if (this.deps.mqttLiefert()) return;

    const ids = HELFER.map((h) => h.entityId);
    let zustaende: Map<string, string>;
    try {
      zustaende = await this.deps.leseZustaende(verbindung, ids);
    } catch {
      return; // Ein Aussetzer darf nichts ausloesen und nichts anhalten.
    }

    const fehlend = fehlendeHelfer(new Set(zustaende.keys()));
    if (fehlend.length > 0) {
      void this.helferAnlegen(verbindung, fehlend);
    }

    for (const befehl of erkenneBefehle(this.zuletzt, zustaende)) {
      this.fuehreAus(befehl.befehl, befehl.wert);
    }
    this.zuletzt = zustaende;
  }

  private async helferAnlegen(
    verbindung: HaConnection,
    fehlend: ReturnType<typeof fehlendeHelfer>,
  ): Promise<void> {
    // Nur EIN Versuch je Lauf: schlaegt das Anlegen fehl (keine Rechte,
    // WebSocket blockiert), waere ein Versuch pro Sekunde eine Dauerlast
    // ohne jede Aussicht auf ein anderes Ergebnis.
    if (this.anlegenLaeuft || this.angelegtVersucht) return;
    this.anlegenLaeuft = true;
    try {
      const angelegt = await legeHelferAn(
        verbindung,
        fehlend,
        { profile: this.deps.profile.getAll().map((p) => p.name) },
        this.deps.ws,
      );
      this.angelegtVersucht = true;
      if (angelegt.length > 0) {
        this.deps.logger.info('Bedien-Helfer in Home Assistant angelegt', { angelegt });
      }
    } finally {
      this.anlegenLaeuft = false;
    }
  }

  private fuehreAus(befehl: string, wert?: string): void {
    try {
      if (befehl === 'pause') this.deps.navigation.pause();
      else if (befehl === 'resume') this.deps.navigation.resume();
      else if (befehl === 'stop') this.deps.navigation.stop();
      else if (befehl === 'profile' && wert) {
        const profil = this.deps.profile.getAll().find((p) => p.name === wert);
        if (!profil) {
          this.deps.logger.warn('Bedien-Helfer: kein Profil mit diesem Namen', { wert });
          return;
        }
        this.deps.profile.activate(profil.id);
      } else {
        return;
      }
      this.deps.logger.info('Bedien-Helfer ausgefuehrt', { befehl, wert });
    } catch (err) {
      // Ein Befehl, der nicht geht (Pause ohne laufende Fahrt), ist eine
      // Meldung wert und kein Grund, den Beobachter anzuhalten.
      this.deps.logger.warn('Bedien-Helfer: Befehl fehlgeschlagen', {
        befehl,
        fehler: err instanceof Error ? err.message : String(err),
      });
    }
  }

  dispose(): void {
    this.entsorgt = true;
    if (this.timer !== null) {
      const clearIntervalFn = this.deps.clearIntervalImpl ?? ((h) => clearInterval(h as never));
      clearIntervalFn(this.timer);
      this.timer = null;
    }
  }
}
