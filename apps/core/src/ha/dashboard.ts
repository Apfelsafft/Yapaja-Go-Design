/* eslint-disable no-undef -- `setTimeout`/`clearTimeout` sind Standard-Globale
 * in Node 22 (typisiert ueber @types/node); dieselbe Begruendung wie in
 * ha/client.ts. */

/**
 * Das fertige Home-Assistant-Dashboard -- mit den Entitaeten, die es auf
 * DIESER Anlage wirklich gibt.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Kannst du ein ha Lovelace Dashboard fuer mich erstellen in dem die
 * Karte mit Route und eigener Position angezeigt wird sowie weitere Karten
 * fuer die naechste richtungsanzeige, aktuelle Geschwindigkeit und
 * Entfernungen bzw eta."
 *
 * ─── WARUM DIE DATEI ERZEUGT UND NICHT MITGELIEFERT WIRD ────────────────────
 * Weil die Entity-IDs nicht feststehen. `docs/04-home-assistant.md` nennt seit
 * jeher `sensor.yapaja_speed` -- Home Assistant vergibt aber, solange die
 * Discovery kein `object_id` mitschickt, eine ID aus GERAETE- plus
 * Entitaetsnamen: `sensor.yapaia_go_speed`. Seit 0.6.9 schickt sie eines mit
 * (`mqtt/discovery.ts`), doch bestehende Anlagen behalten ihre einmal
 * vergebenen IDs -- die Registrierung benennt nichts um.
 *
 * Ein fest mitgeliefertes Dashboard waere also fuer jede aeltere Installation
 * eine Wand aus „Entitaet nicht verfuegbar". Deshalb sieht das Add-on beim
 * Start in Home Assistant NACH, welche Entitaeten es gibt, und schreibt die
 * gefundenen IDs in die Datei. Was es nicht findet, traegt es mit dem
 * dokumentierten Namen ein -- und sagt im Protokoll, welche das waren.
 *
 * ─── WORAN DIE ENTITAETEN ERKANNT WERDEN ────────────────────────────────────
 * An der Endung der Entity-ID (`..._speed`, `..._distance_remaining`) und
 * daran, dass „yapa" darin vorkommt. Beides zusammen, nicht eines davon:
 * „endet auf _speed" allein traefe auch das Tempo eines fremden Geraets,
 * „enthaelt yapa" allein traefe jede unserer Entitaeten fuer jede Suche.
 * Findet sich darueber nichts, wird der ANZEIGENAME herangezogen (den setzen
 * wir in `mqtt/discovery.ts` ebenfalls selbst).
 */

import type { HaEntityState } from './client.js';
import { HELFER } from './commandHelpers.js';

/**
 * Die Dateinamen unter `www/yapaja/` -- also `/local/yapaja/dashboard.yaml`
 * und `/local/yapaja/dashboard.txt`. Warum zweimal: siehe
 * {@link writeDashboardYaml}.
 */
export const DASHBOARD_DATEINAMEN = ['dashboard.yaml', 'dashboard.txt'] as const;

/**
 * Die Marke am Dateianfang, die dem Browser sagt: das ist UTF-8.
 * Warum sie noetig ist, steht bei {@link writeDashboardYaml}.
 */
export const UTF8_BOM = '\uFEFF';

/**
 * Wie lange nach dem Start gewartet wird, bevor in Home Assistant
 * nachgesehen wird.
 *
 * Nicht sofort: beim gemeinsamen Hochfahren hat Home Assistant die
 * MQTT-Discovery noch nicht verarbeitet, und dann faende die Suche nichts und
 * traege ueberall die Vorgabe ein -- ausgerechnet bei der Erstinstallation,
 * wo es am meisten weh taete. Vorher liegt bereits die Fassung mit den
 * dokumentierten Namen da; sie wird danach ersetzt.
 */
export const DASHBOARD_NACHSEHEN_MS = 30_000;

export interface DashboardEntity {
  /** Der Name, unter dem die Vorlage sie einsetzt. */
  schluessel: string;
  /** `sensor`, `binary_sensor`, `button`, `select`. */
  domain: string;
  /** Die `object_id` aus `mqtt/discovery.ts` -- ohne Domain. */
  objectId: string;
  /** Der `name` aus der Discovery, fuer die Suche ueber den Anzeigenamen. */
  name: string;
}

/** Genau die Entitaeten, die die Vorlage unten einsetzt. */
export const DASHBOARD_ENTITIES: readonly DashboardEntity[] = [
  { schluessel: 'instruction', domain: 'sensor', objectId: 'yapaja_instruction', name: 'Instruction' },
  {
    schluessel: 'instruction_distance',
    domain: 'sensor',
    objectId: 'yapaja_instruction_distance',
    name: 'Instruction Distance',
  },
  { schluessel: 'speed', domain: 'sensor', objectId: 'yapaja_speed', name: 'Speed' },
  {
    schluessel: 'speed_limit',
    domain: 'sensor',
    objectId: 'yapaja_speed_limit',
    name: 'Speed Limit',
  },
  {
    schluessel: 'speeding',
    domain: 'binary_sensor',
    objectId: 'yapaja_speeding',
    name: 'Speeding',
  },
  { schluessel: 'eta', domain: 'sensor', objectId: 'yapaja_eta', name: 'ETA' },
  {
    schluessel: 'distance_remaining',
    domain: 'sensor',
    objectId: 'yapaja_distance_remaining',
    name: 'Distance Remaining',
  },
  {
    schluessel: 'destination',
    domain: 'sensor',
    objectId: 'yapaja_destination',
    name: 'Destination',
  },
  { schluessel: 'nav_state', domain: 'sensor', objectId: 'yapaja_nav_state', name: 'Nav State' },
  { schluessel: 'profile', domain: 'select', objectId: 'yapaja_profile', name: 'Profile' },
  { schluessel: 'stop', domain: 'button', objectId: 'yapaja_stop', name: 'Stop' },
  { schluessel: 'pause', domain: 'button', objectId: 'yapaja_pause', name: 'Pause' },
  { schluessel: 'resume', domain: 'button', objectId: 'yapaja_resume', name: 'Resume' },
] as const;

export type EntityIds = Record<string, string>;

export interface AufgeloesteIds {
  ids: EntityIds;
  /** Schluessel, die in Home Assistant wirklich gefunden wurden. */
  gefunden: string[];
  /** Schluessel, fuer die der dokumentierte Name eingetragen wurde. */
  vorgabe: string[];
}

/** Die dokumentierten IDs -- was ohne Nachsehen eingetragen wuerde. */
export function standardIds(): EntityIds {
  const ids: EntityIds = {};
  for (const e of DASHBOARD_ENTITIES) ids[e.schluessel] = `${e.domain}.${e.objectId}`;
  return ids;
}

function anzeigename(zustand: HaEntityState): string {
  const wert = zustand.attributes?.friendly_name;
  return typeof wert === 'string' ? wert : '';
}

/**
 * Sucht zu jeder Entitaet die ID, unter der sie in dieser Anlage laeuft.
 * Nicht Gefundenes bekommt den dokumentierten Namen.
 */
export function resolveEntityIds(zustaende: readonly HaEntityState[]): AufgeloesteIds {
  const ids = standardIds();
  const gefunden: string[] = [];
  const vorgabe: string[] = [];

  for (const eintrag of DASHBOARD_ENTITIES) {
    const vorgesehen = `${eintrag.domain}.${eintrag.objectId}`;
    // Die Endung, an der die Entitaet haengt: aus `yapaja_speed` wird
    // `_speed`, aus `yapaja_distance_remaining` wird `_distance_remaining`.
    const endung = eintrag.objectId.replace(/^yapaja/, '');
    const passend = zustaende.filter((z) => {
      if (typeof z.entity_id !== 'string') return false;
      if (!z.entity_id.startsWith(`${eintrag.domain}.`)) return false;
      const nachDomain = z.entity_id.slice(eintrag.domain.length + 1);
      const unser = /yapa/i.test(nachDomain) || /yapa/i.test(anzeigename(z));
      if (!unser) return false;
      return (
        z.entity_id === vorgesehen ||
        nachDomain.endsWith(endung) ||
        anzeigename(z).toLowerCase().endsWith(eintrag.name.toLowerCase())
      );
    });

    if (passend.length === 0) {
      vorgabe.push(eintrag.schluessel);
      continue;
    }
    // Bei mehreren gewinnt die vorgesehene ID, sonst die kuerzeste --
    // damit dieselbe Anlage immer dieselbe Datei bekommt und nicht bei
    // jedem Start eine andere.
    const genau = passend.find((z) => z.entity_id === vorgesehen);
    const gewaehlt =
      genau ??
      [...passend].sort((a, b) => a.entity_id.length - b.entity_id.length || (a.entity_id < b.entity_id ? -1 : 1))[0];
    ids[eintrag.schluessel] = gewaehlt.entity_id;
    gefunden.push(eintrag.schluessel);
  }

  return { ids, gefunden, vorgabe };
}

/**
 * Welche der Bedien-Helfer (`input_button.yapaia_*`, `input_select.yapaia_profil`)
 * es in dieser Anlage gibt.
 *
 * Hier wird NICHT gesucht wie oben, sondern genau verglichen: die IDs dieser
 * Helfer legt Yapaia selbst an (`ha/commandHelpers.ts`), sie stehen fest. Eine
 * unscharfe Suche koennte hier nur danebengreifen.
 */
export function findeHelfer(zustaende: readonly HaEntityState[]): string[] {
  const vorhanden = new Set(zustaende.map((z) => z.entity_id));
  return HELFER.map((h) => h.entityId).filter((id) => vorhanden.has(id));
}

/** Die Helfer-ID zu einem Befehl -- oder `undefined`, wenn es keinen gibt. */
function helferId(befehl: (typeof HELFER)[number]['befehl']): string | undefined {
  return HELFER.find((h) => h.befehl === befehl)?.entityId;
}

/** Was beim Nachsehen in Home Assistant herauskam. */
export interface Befund {
  /** Ob Home Assistant ueberhaupt geantwortet hat. */
  erreichbar: boolean;
  /** Wie viele Zustaende gelesen wurden (0 = nichts gelesen). */
  zustaende: number;
  /** Wie viele der gesuchten Entitaeten gefunden wurden. */
  gefunden: number;
  /** Schluessel, fuer die die Vorgabe eingetragen wurde. */
  vorgabe: string[];
  /** Die gefundenen Bedien-Helfer -- der Weg ohne MQTT. */
  helfer?: readonly string[];
}

/**
 * Der Kopf der Datei, der sagt, WAS beim Erzeugen los war.
 *
 * ─── WARUM DAS DRINSTEHT ────────────────────────────────────────────────────
 * Auf dem iPad des Betreibers stand in fast jeder Kachel „Entitaet nicht
 * gefunden" -- und nirgends, warum. Das ist genau der stille Ausfall, den
 * dieses Projekt schon mehrfach gekostet hat: eine Wand aus Warnungen, aus
 * der man nicht ablesen kann, ob die Datei falsch ist, Home Assistant nicht
 * antwortet oder es die Entitaeten schlicht nicht gibt.
 *
 * Der haeufigste Fall ist der letzte, und er hat eine einzige Ursache: OHNE
 * MQTT-Broker meldet Yapaia gar keine Entitaeten an Home Assistant. Dann ist
 * nicht das Dashboard kaputt -- es gibt nichts anzuzeigen.
 */
export function befundText(befund?: Befund): string {
  if (!befund) return '';
  const zeilen: string[] = ['# ─── Was beim Erzeugen gefunden wurde ─────────────────────────────────'];

  if (!befund.erreichbar) {
    zeilen.push(
      '# Home Assistant war nicht erreichbar. Unten stehen deshalb die',
      '# dokumentierten Namen -- sie stimmen nur bei einer Neuinstallation.',
      '# Das Add-on schreibt die Datei bei jedem Start neu; ein Neustart des',
      '# Add-ons erzeugt sie also noch einmal.',
    );
  } else if (befund.gefunden === 0) {
    zeilen.push(
      `# Home Assistant ist erreichbar (${befund.zustaende} Entitäten gelesen),`,
      '# aber es gibt dort KEINE EINZIGE Yapaia-Entität.',
      '#',
      '# Das heißt fast immer: das Add-on ist mit keinem MQTT-Broker verbunden.',
      '# Ohne den meldet Yapaia nichts an Home Assistant — dann ist nicht das',
      '# Dashboard leer, sondern es gibt nichts anzuzeigen. Die Karte oben',
      '# funktioniert trotzdem, sie kommt direkt aus dem Add-on.',
      '#',
      '# Nachsehen: Yapaia Go öffnen → 🩺 Installationsprüfung → Zeile',
      '# „MQTT / Home-Assistant-Anbindung". Fehlt der Broker, hilft das',
      '# Mosquitto-Add-on (Einstellungen → Add-ons → Add-on-Store).',
    );
  } else if (befund.vorgabe.length > 0) {
    zeilen.push(
      `# ${befund.gefunden} von ${befund.gefunden + befund.vorgabe.length} Entitäten gefunden.`,
      `# Für diese hier gab es keine: ${befund.vorgabe.join(', ')}.`,
      '# Ihre Kacheln zeigen „Entität nicht gefunden" — der Rest funktioniert.',
    );
  } else {
    zeilen.push(`# Alle ${befund.gefunden} Entitäten gefunden.`);
  }

  if (befund.helfer && befund.helfer.length > 0) {
    const steuerungFehlt = ['profile', 'stop', 'pause', 'resume'].some((k) =>
      befund.vorgabe.includes(k),
    );
    zeilen.push('#');
    if (steuerungFehlt) {
      zeilen.push(
        `# Bedienen ohne MQTT: ${befund.helfer.length} Helfer gefunden`,
        '# (input_button.yapaia_*, input_select.yapaia_profil). Yapaia legt sie',
        '# selbst an und hört auf sie — die Steuerungskacheln unten benutzen sie.',
      );
    } else {
      // Sonst suchte jemand den Fehler bei sich: die Helfer sind da, sie
      // reagieren nur nicht, weil der andere Kanal die Bedienung liefert.
      zeilen.push(
        `# Es gibt außerdem ${befund.helfer.length} Bedien-Helfer (input_button.yapaia_*).`,
        '# Sie werden IGNORIERT, solange MQTT läuft — sonst gäbe es zwei Sätze',
        '# Knöpfe für dieselbe Sache. Die Kacheln unten benutzen die',
        '# MQTT-Entitäten.',
      );
    }
  }

  return `${zeilen.join('\n')}\n#\n`;
}

/**
 * Das Dashboard selbst, zum Einfuegen in den Rohtext-Editor
 * (Dashboard -> Bearbeiten -> ⋮ -> Rohkonfigurationseditor).
 */
export function buildDashboardYaml(ids: EntityIds, befund?: Befund): string {
  const e = (schluessel: string): string => ids[schluessel] ?? `sensor.yapaja_${schluessel}`;
  return `# Yapaia Go — fertiges Dashboard
#
# Erzeugt vom Add-on beim Start. Die Entity-IDs unten sind die, die in DIESER
# Home-Assistant-Installation wirklich vorhanden waren.
#
${befundText(befund)}#
# So kommt es ins Dashboard:
#   1. Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen
#        URL: /local/yapaja/yapaja-map-card.js     Typ: JavaScript-Modul
#      (einmalig; ohne diesen Schritt bleibt die Kartenkachel leer)
#   2. Einstellungen → Dashboards → Dashboard hinzufügen → Neu von Grund auf
#   3. Im neuen Dashboard: Stift → ⋮ → Rohkonfigurationseditor
#   4. Alles ersetzen durch diesen Text, speichern.
views:
  - title: Navigation
    path: yapaia
    icon: mdi:map-marker-path
    cards:
      - type: custom:yapaja-map-card
        title: Karte mit Route
        height: 420

      - type: markdown
        title: Nächste Anweisung
        content: |
          {% set anweisung = states('${e('instruction')}') %}
          {% set meter = states('${e('instruction_distance')}') %}
          {% if anweisung in ['unknown', 'unavailable', 'none', ''] %}
          Keine laufende Navigation.
          {% else %}
          <ha-icon icon="{{ state_attr('${e('instruction')}', 'icon') or 'mdi:navigation' }}"></ha-icon>

          ## {{ anweisung }}
          {% if meter not in ['unknown', 'unavailable', 'none', ''] %}
          **noch {{ meter | float(0) | round(0) }} m**
          {% endif %}
          {% endif %}

      - type: gauge
        entity: ${e('speed')}
        name: Geschwindigkeit
        min: 0
        max: 140
        needle: true
        severity:
          green: 0
          yellow: 100
          red: 130

      - type: conditional
        conditions:
          - condition: state
            entity: ${e('speeding')}
            state: 'on'
        card:
          type: markdown
          content: |
            ## ⚠️ Zu schnell
            Erlaubt sind {{ states('${e('speed_limit')}') }} km/h.

      - type: entities
        title: Entfernung und Ankunft
        entities:
          - entity: ${e('destination')}
            name: Ziel
          - entity: ${e('distance_remaining')}
            name: Verbleibende Strecke
          - entity: ${e('eta')}
            name: Ankunft
          - entity: ${e('speed_limit')}
            name: Tempolimit
          - entity: ${e('nav_state')}
            name: Zustand

${steuerungsKacheln(ids, befund)}`;
}

/**
 * Die bedienbaren Kacheln -- aus dem Kanal, den es auf DIESER Anlage gibt.
 *
 * ─── ZWEI WEGE, EINE KACHELREIHE ────────────────────────────────────────────
 * Mit MQTT gibt es `button.yapaja_pause` und `select.yapaja_profile`: echte
 * bedienbare Entitaeten, an denen Yapaia haengt.
 *
 * Ohne MQTT gibt es sie nicht -- eine Entitaet, die der HA-interne Kanal ueber
 * `POST /api/states` schreibt, kann keine Befehle entgegennehmen
 * (`ha/statesBridge.ts`). Deshalb legt Yapaia dort HELFER an
 * (`input_button.yapaia_pause`, `input_select.yapaia_profil`) und beobachtet
 * sie (`ha/commandWatcher.ts`). Findet sich einer davon, benutzt die Kachel
 * ihn -- die Bedienung funktioniert dann genauso, nur ueber eine andere
 * Entitaet.
 *
 * ─── UND WARUM SIE IMMER NOCH GANZ FEHLEN DUERFEN ───────────────────────────
 * Gibt es weder das eine noch das andere, steht hier nichts. Ein Knopf, der
 * nichts tut, ist schlimmer als ein fehlender: er behauptet, er wuerde. Auf
 * dem Bildschirmfoto des Betreibers war genau das zu sehen.
 */
export function steuerungsKacheln(ids: EntityIds, befund?: Befund): string {
  const e = (schluessel: string): string => ids[schluessel] ?? `sensor.yapaja_${schluessel}`;
  const fehlt = new Set(befund?.vorgabe ?? []);
  const helfer = new Set(befund?.helfer ?? []);
  // Ohne Befund (noch nicht nachgesehen) bleiben sie drin: die erste Fassung
  // der Datei geht von den dokumentierten Namen aus.
  const knoepfe = !['stop', 'pause', 'resume'].every((k) => fehlt.has(k));
  const profil = !fehlt.has('profile');
  const helferProfilId = helferId('profile');
  const helferProfil = !profil && helferProfilId !== undefined && helfer.has(helferProfilId);
  const helferBefehle = (['pause', 'resume', 'stop'] as const).map((b) => helferId(b));
  const helferKnoepfe = !knoepfe && helferBefehle.every((id) => id !== undefined && helfer.has(id));
  if (!knoepfe && !profil && !helferKnoepfe && !helferProfil) return '';

  const teile: string[] = [];
  if (profil) {
    teile.push(`      - type: entities
        title: Steuerung
        entities:
          - entity: ${e('profile')}
            name: Fahrzeugprofil`);
  } else if (helferProfil) {
    teile.push(`      - type: entities
        title: Steuerung
        entities:
          - entity: ${helferProfilId}
            name: Fahrzeugprofil`);
  }
  if (helferKnoepfe) {
    // Dieselben drei Knoepfe, nur ueber die Helfer. `input_button.press`
    // statt `button.press` -- verschiedene Bereiche, verschiedene Aktion.
    const [hPause, hWeiter, hStop] = helferBefehle as [string, string, string];
    teile.push(`      - type: horizontal-stack
        cards:
          - type: button
            name: Pause
            icon: mdi:pause
            tap_action:
              action: perform-action
              perform_action: input_button.press
              target:
                entity_id: ${hPause}
          - type: button
            name: Weiter
            icon: mdi:play
            tap_action:
              action: perform-action
              perform_action: input_button.press
              target:
                entity_id: ${hWeiter}
          - type: button
            name: Beenden
            icon: mdi:stop
            tap_action:
              action: perform-action
              perform_action: input_button.press
              target:
                entity_id: ${hStop}`);
  }
  if (knoepfe) {
    teile.push(`      - type: horizontal-stack
        cards:
          - type: button
            name: Pause
            icon: mdi:pause
            tap_action:
              action: perform-action
              perform_action: button.press
              target:
                entity_id: ${e('pause')}
          - type: button
            name: Weiter
            icon: mdi:play
            tap_action:
              action: perform-action
              perform_action: button.press
              target:
                entity_id: ${e('resume')}
          - type: button
            name: Beenden
            icon: mdi:stop
            tap_action:
              action: perform-action
              perform_action: button.press
              target:
                entity_id: ${e('stop')}`);
  }
  return `\n${teile.join('\n')}\n`;
}

/** Nur das, was zum Schreiben gebraucht wird -- so ist es ohne Dateisystem pruefbar. */
export interface DashboardDateiDeps {
  mkdir: (pfad: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (pfad: string, inhalt: string, kodierung: 'utf8') => Promise<void>;
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
}

/**
 * Schreibt die Vorlage nach `<www>/dashboard.yaml` -- und Wort fuer Wort
 * dasselbe noch einmal als `dashboard.txt`.
 *
 * ─── WARUM ZWEIMAL ──────────────────────────────────────────────────────────
 * Der Betreiber soll den Text im Browser SEHEN und herauskopieren koennen,
 * ohne SSH und ohne Datei-Editor. Welchen Inhaltstyp Home Assistant fuer
 * `.yaml` meldet, haengt an der Python-Fassung darunter -- meldet es einen,
 * den der Browser nicht anzeigt, laedt Safari die Datei herunter, und auf
 * einem iPad ist sie damit praktisch weg. `.txt` zeigt jeder Browser an.
 * Zwei Kilobyte gegen einen Weg, der genau bei der Person nicht funktioniert,
 * die ihn gehen soll.
 *
 * ─── UND WARUM MIT BOM ──────────────────────────────────────────────────────
 * Weil es sonst „NÃ¤chste Anweisung" heisst. Home Assistant liefert die Datei
 * aus seinem `www/` ohne Angabe des Zeichensatzes aus; Safari nimmt dann
 * Latin-1 an, und aus jedem Umlaut werden zwei Zeichen. Der Betreiber kopiert
 * genau das ins Dashboard -- die Vorlage ist dann kaputt, bevor sie irgendwo
 * ankommt (auf dem iPad nachgesehen, Kachelueberschrift „NÃ¤chste Anweisung").
 *
 * Die drei Bytes am Anfang sagen dem Browser, dass es UTF-8 ist; das schlaegt
 * jede Vorannahme. Beim Markieren und Kopieren des angezeigten Textes ist die
 * Marke nicht dabei -- sie ist kein sichtbares Zeichen.
 *
 * Wirft NIE: ein Dashboard, das sich nicht ablegen laesst, darf die
 * Navigation nicht anhalten. Gibt zurueck, ob BEIDE geschrieben wurden.
 */
export async function writeDashboardYaml(
  wwwDir: string,
  yaml: string,
  deps: DashboardDateiDeps,
): Promise<boolean> {
  const ordner = wwwDir.replace(/\/+$/, '');
  try {
    await deps.mkdir(wwwDir, { recursive: true });
    for (const name of DASHBOARD_DATEINAMEN) {
      await deps.writeFile(`${ordner}/${name}`, `${UTF8_BOM}${yaml}`, 'utf8');
    }
    return true;
  } catch (err) {
    deps.logger.warn('Dashboard-Vorlage konnte nicht geschrieben werden', {
      ordner,
      fehler: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Alles, was die Pflege braucht -- eingereicht, damit sie pruefbar ist. */
export interface DashboardPflegeDeps {
  /** `<ha-config>/www/yapaja`, oder `null` ausserhalb des Add-ons. */
  wwwDir: string | null;
  /** Die HA-Verbindung, oder `null`, solange keine konfiguriert ist. */
  verbindung: () => HaVerbindung | null;
  ladeZustaende: (verbindung: HaVerbindung) => Promise<HaEntityState[]>;
  datei: DashboardDateiDeps;
  verzoegerungMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

/** Nur das Stueck der HA-Verbindung, das hier weitergereicht wird. */
export interface HaVerbindung {
  apiBase: string;
  token: string;
}

/**
 * Legt die Dashboard-Vorlage ab und bessert sie nach, sobald Home Assistant
 * die Entitaeten kennt.
 *
 * ZWEI SCHRITTE, und der erste ist der wichtige: SOFORT liegt eine Datei da
 * -- mit den dokumentierten Namen. Wer gleich nach der Installation
 * nachschaut, findet etwas Brauchbares statt einer 404. Erst danach wird
 * nachgesehen, welche IDs es wirklich gibt, und die Datei ersetzt.
 *
 * @returns eine Funktion, die die geplante Nachbesserung abbestellt
 */
export function starteDashboardPflege(deps: DashboardPflegeDeps): () => void {
  const { wwwDir } = deps;
  if (!wwwDir) return () => undefined;

  const setTimeoutFn = deps.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = deps.clearTimeoutImpl ?? ((h) => clearTimeout(h as never));

  void writeDashboardYaml(wwwDir, buildDashboardYaml(standardIds()), deps.datei);

  const handle = setTimeoutFn(() => {
    void (async () => {
      const verbindung = deps.verbindung();
      if (!verbindung) {
        // Auch dieser Fall kommt jetzt IN die Datei: „keine Verbindung" nur
        // ins Protokoll zu schreiben half niemandem, der vor einer Wand aus
        // „Entitaet nicht gefunden" sitzt.
        await writeDashboardYaml(
          wwwDir,
          buildDashboardYaml(standardIds(), {
            erreichbar: false,
            zustaende: 0,
            gefunden: 0,
            vorgabe: Object.keys(standardIds()),
          }),
          deps.datei,
        );
        deps.datei.logger.info(
          'Dashboard-Vorlage: keine Home-Assistant-Verbindung -- es bleiben die dokumentierten Entity-IDs.',
        );
        return;
      }
      const zustaende = await deps.ladeZustaende(verbindung);
      const { ids, gefunden, vorgabe } = resolveEntityIds(zustaende);
      // `zustaende.length === 0` heisst bei `fetchHaStates` „nicht
      // erreichbar": die Funktion schluckt jeden Fehler und liefert eine
      // leere Liste. Eine echte HA-Anlage hat immer Entitaeten.
      const befund: Befund = {
        erreichbar: zustaende.length > 0,
        zustaende: zustaende.length,
        gefunden: gefunden.length,
        vorgabe,
        helfer: findeHelfer(zustaende),
      };
      await writeDashboardYaml(wwwDir, buildDashboardYaml(ids, befund), deps.datei);
      deps.datei.logger.info('Dashboard-Vorlage geschrieben (/local/yapaja/dashboard.yaml)', {
        gefunden: gefunden.length,
        vorgabe,
        zustaende: zustaende.length,
      });
      if (befund.erreichbar && befund.gefunden === 0) {
        deps.datei.logger.warn(
          'Dashboard-Vorlage: Home Assistant kennt KEINE Yapaia-Entitaet. Ohne MQTT-Broker meldet Yapaia keine an -- siehe Installationspruefung, Zeile „MQTT / Home-Assistant-Anbindung".',
        );
      }
    })();
  }, deps.verzoegerungMs ?? DASHBOARD_NACHSEHEN_MS);

  return () => clearTimeoutFn(handle);
}
