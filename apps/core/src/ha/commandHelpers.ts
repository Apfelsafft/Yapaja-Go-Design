/* eslint-disable no-undef -- `setInterval`/`clearInterval`/`WebSocket` sind
 * Standard-Globale in Node 22 (WebSocket seit Node 21 fest eingebaut);
 * dieselbe Begruendung wie in ha/client.ts. */

/**
 * Bedienen ohne MQTT: Pause, Weiter, Beenden und die Profilwahl.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Im Grunde sollte moeglichst -- also sofern technisch ueberhaupt
 * moeglich -- alles funktionieren. Der User waehlt ja seinen Kanal aus."
 *
 * In 0.7.0 stand dazu noch das Gegenteil im Changelog: die bedienbaren
 * Entitaeten gebe es nur mit MQTT. Das stimmt fuer den Weg ueber
 * `POST /api/states` auch -- ein so geschriebener Zustand nimmt nichts
 * entgegen. Es gibt aber einen zweiten Weg, und den geht diese Datei.
 *
 * ─── WIE ────────────────────────────────────────────────────────────────────
 * Home Assistant kann HELFER anlegen: `input_button` und `input_select`. Das
 * sind vollwertige, bedienbare Entitaeten -- nur legt sie normalerweise ein
 * Mensch in der Oberflaeche an. Anlegen geht ausschliesslich ueber die
 * WebSocket-Schnittstelle (`input_button/create`; die REST-Schnittstelle hat
 * dafuer keinen Endpunkt -- nachgesehen in `components/input_button`, dort
 * steht nur `DictStorageCollectionWebsocket`).
 *
 * Also legt Yapaia sie selbst an. Node 22 bringt `WebSocket` mit, es kommt
 * keine Abhaengigkeit dazu.
 *
 * GEDRUECKT wird dann ganz normal -- und Yapaia sieht es, weil der Zustand
 * eines `input_button` der ZEITPUNKT des letzten Druecks ist. Aendert er
 * sich, wurde gedrueckt. Dafuer genuegt die REST-Schnittstelle, die ohnehin
 * benutzt wird; eine dauerhafte WebSocket-Verbindung mit allem, was daran
 * haengt (Wiederverbinden, Zaehlerstaende, halboffene Leitungen), braucht es
 * dafuer nicht.
 *
 * ─── WARUM DIE HELFER „yapaia_" HEISSEN UND NICHT „yapaja_" ─────────────────
 * Weil sie neu sind. Die bestehenden Entitaeten heissen `yapaja_*`, weil
 * Home Assistant einmal vergebene IDs nie umbenennt und der Name aus der Zeit
 * vor der Korrektur stammt (0.6.7). Was hier NEU entsteht, bekommt die
 * richtige Schreibweise. Verwechseln kann man sie ohnehin nicht: `button.*`
 * und `input_button.*` sind verschiedene Bereiche.
 */

import type { HaConnection } from './config.js';

export type HelferTyp = 'input_button' | 'input_select';

export interface HelferSoll {
  /** Die Entity-ID, die Home Assistant aus dem Namen bildet. */
  entityId: string;
  typ: HelferTyp;
  /** Der Name, aus dem die ID entsteht -- kleingeschrieben, Punkte zu `_`. */
  name: string;
  icon: string;
  /** Was der Druck ausloest. Bei `input_select` steht hier die Bedeutung. */
  befehl: 'pause' | 'resume' | 'stop' | 'profile';
}

/** Die Helfer, die Yapaia anlegt und beobachtet. */
export const HELFER: readonly HelferSoll[] = [
  {
    entityId: 'input_button.yapaia_pause',
    typ: 'input_button',
    name: 'Yapaia Pause',
    icon: 'mdi:pause',
    befehl: 'pause',
  },
  {
    entityId: 'input_button.yapaia_weiter',
    typ: 'input_button',
    name: 'Yapaia Weiter',
    icon: 'mdi:play',
    befehl: 'resume',
  },
  {
    entityId: 'input_button.yapaia_beenden',
    typ: 'input_button',
    name: 'Yapaia Beenden',
    icon: 'mdi:stop',
    befehl: 'stop',
  },
  {
    entityId: 'input_select.yapaia_profil',
    typ: 'input_select',
    name: 'Yapaia Profil',
    icon: 'mdi:truck',
    befehl: 'profile',
  },
] as const;

/**
 * Die WebSocket-Adresse zur selben Home-Assistant-Instanz.
 *
 * Zwei Formen, weil es zwei Wege dorthin gibt: der Supervisor-Umweg des
 * Add-ons (`http://supervisor/core/api`) und eine direkt eingetragene
 * Instanz (`http://ha.lan:8123/api`). Wer hier nur eine der beiden
 * behandelt, baut eine Funktion, die genau in der einen Haelfte der
 * Installationen still nichts tut.
 */
export function wsUrlFor(apiBase: string): string {
  const ws = apiBase.replace(/^http/, 'ws');
  if (ws.endsWith('/core/api')) return `${ws.slice(0, -'/core/api'.length)}/core/websocket`;
  return `${ws}/websocket`;
}

/** Welche der Soll-Helfer in Home Assistant noch fehlen. */
export function fehlendeHelfer(vorhanden: ReadonlySet<string>): HelferSoll[] {
  return HELFER.filter((helfer) => !vorhanden.has(helfer.entityId));
}

/** Ein Druck oder eine Auswahl, erkannt am geaenderten Zustand. */
export interface ErkannterBefehl {
  befehl: HelferSoll['befehl'];
  /** Bei `profile` die gewaehlte Option. */
  wert?: string;
}

/**
 * Was sich seit der letzten Abfrage geaendert hat.
 *
 * ─── WARUM DER ERSTE DURCHGANG NICHTS AUSLOEST ──────────────────────────────
 * Der Zustand eines `input_button` ist der Zeitpunkt des letzten Drucks --
 * auch wenn der Tage her ist. Ohne diese Regel loeste jeder Neustart des
 * Add-ons alle drei Befehle auf einmal aus: die Fahrt waere beendet, bevor
 * jemand etwas angefasst hat. Deshalb ist der erste gelesene Wert nur die
 * Grundlinie, nie ein Befehl.
 */
export function erkenneBefehle(
  vorher: ReadonlyMap<string, string>,
  jetzt: ReadonlyMap<string, string>,
): ErkannterBefehl[] {
  const befehle: ErkannterBefehl[] = [];
  for (const helfer of HELFER) {
    const neu = jetzt.get(helfer.entityId);
    if (neu === undefined) continue;
    const alt = vorher.get(helfer.entityId);
    if (alt === undefined) continue; // Grundlinie, kein Befehl.
    if (alt === neu) continue;
    if (helfer.typ === 'input_select') {
      // „unknown"/„unavailable" ist keine Wahl, sondern das Fehlen einer.
      if (neu === 'unknown' || neu === 'unavailable' || neu.length === 0) continue;
      befehle.push({ befehl: helfer.befehl, wert: neu });
    } else {
      befehle.push({ befehl: helfer.befehl });
    }
  }
  return befehle;
}

export interface WsLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface WsDeps {
  /** Injizierbar fuer Tests -- sonst der eingebaute `WebSocket` von Node. */
  erzeugeSocket?: (url: string) => WebSocketAehnlich;
  logger: WsLogger;
  timeoutMs?: number;
}

/** Nur das, was hier von einem WebSocket gebraucht wird. */
export interface WebSocketAehnlich {
  send(data: string): void;
  close(): void;
  addEventListener(typ: 'message', hoerer: (ereignis: { data: unknown }) => void): void;
  addEventListener(typ: 'open' | 'error' | 'close', hoerer: () => void): void;
}

const STANDARD_TIMEOUT_MS = 10_000;

/**
 * Legt die fehlenden Helfer an.
 *
 * Wirft NIE: fehlende Bedienknoepfe sind aergerlich, ein Add-on, das deshalb
 * nicht startet, waere schlimmer. Gibt die Entity-IDs zurueck, die angelegt
 * wurden.
 */
export async function legeHelferAn(
  verbindung: HaConnection,
  fehlend: readonly HelferSoll[],
  optionen: { profile?: string[] } = {},
  deps: WsDeps,
): Promise<string[]> {
  if (fehlend.length === 0) return [];
  const erzeuge = deps.erzeugeSocket ?? ((url: string) => new WebSocket(url) as WebSocketAehnlich);
  const timeoutMs = deps.timeoutMs ?? STANDARD_TIMEOUT_MS;

  return new Promise<string[]>((fertig) => {
    const angelegt: string[] = [];
    let socket: WebSocketAehnlich | null = null;
    let abgeschlossen = false;
    let naechsteId = 1;
    const offen = new Map<number, HelferSoll>();

    const beenden = (): void => {
      if (abgeschlossen) return;
      abgeschlossen = true;
      clearTimeout(uhr);
      try {
        socket?.close();
      } catch {
        // Eine Leitung, die sich nicht schliessen laesst, ist nichts, was
        // hier noch jemanden interessiert.
      }
      fertig(angelegt);
    };
    const uhr = setTimeout(() => {
      deps.logger.warn('HA-Helfer: Zeitlimit beim Anlegen ueberschritten.');
      beenden();
    }, timeoutMs);

    try {
      socket = erzeuge(wsUrlFor(verbindung.apiBase));
    } catch (err) {
      deps.logger.warn('HA-Helfer: keine WebSocket-Verbindung moeglich', {
        fehler: err instanceof Error ? err.message : String(err),
      });
      beenden();
      return;
    }

    socket.addEventListener('error', () => {
      deps.logger.warn('HA-Helfer: WebSocket-Fehler.');
      beenden();
    });
    socket.addEventListener('close', () => beenden());

    socket.addEventListener('message', (ereignis) => {
      let nachricht: Record<string, unknown>;
      try {
        nachricht = JSON.parse(String(ereignis.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (nachricht.type === 'auth_required') {
        socket?.send(JSON.stringify({ type: 'auth', access_token: verbindung.token }));
        return;
      }
      if (nachricht.type === 'auth_invalid') {
        deps.logger.warn('HA-Helfer: Home Assistant hat die Anmeldung abgelehnt.');
        beenden();
        return;
      }
      if (nachricht.type === 'auth_ok') {
        for (const helfer of fehlend) {
          const id = naechsteId++;
          offen.set(id, helfer);
          socket?.send(
            JSON.stringify(
              helfer.typ === 'input_select'
                ? {
                    id,
                    type: 'input_select/create',
                    name: helfer.name,
                    icon: helfer.icon,
                    // Eine Auswahl braucht mindestens eine Option; ohne
                    // Profile steht hier ein Platzhalter, den der spaetere
                    // Abgleich ersetzt.
                    options: optionen.profile?.length ? optionen.profile : ['—'],
                  }
                : { id, type: 'input_button/create', name: helfer.name, icon: helfer.icon },
            ),
          );
        }
        return;
      }
      if (nachricht.type === 'result') {
        const helfer = offen.get(Number(nachricht.id));
        offen.delete(Number(nachricht.id));
        if (helfer) {
          if (nachricht.success === true) {
            angelegt.push(helfer.entityId);
          } else {
            deps.logger.warn('HA-Helfer konnte nicht angelegt werden', {
              entityId: helfer.entityId,
              antwort: JSON.stringify(nachricht.error ?? {}),
            });
          }
        }
        if (offen.size === 0) beenden();
      }
    });
  });
}
