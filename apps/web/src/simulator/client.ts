/**
 * Zugriff auf den eingebauten Testfahrer (`/api/v1/simulator/*`).
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege einen GPS-Simulator ein, der die gewaehlte Route dann zum
 * Test abfaehrt. [...] Und es sollte eine Art fast forward geben, um die
 * benoetigte Zeit zu verkuerzen. (2x, 4x, 8x, 16x, 32x und zurueck)"
 *
 * ─── ZWEI DINGE, DIE HIER WICHTIG SIND ──────────────────────────────────────
 * 1. Die URL wird aus `import.meta.env.BASE_URL` gebaut, nie als absoluter
 *    `/api/...`-Pfad -- sonst bricht jeder Aufruf unter einem
 *    Ingress-Unterpfad (W-15).
 *
 * 2. `403` ist hier KEIN Fehler, sondern eine Auskunft: der Simulator ist in
 *    dieser Installation gesperrt. Im Add-on laeuft der Core mit
 *    `NODE_ENV=production`, und dort bleiben alle Simulator-Routen
 *    verschlossen, solange der Haken in der Add-on-Konfiguration nicht
 *    gesetzt ist. Die Oberflaeche muss diesen Unterschied kennen -- sonst
 *    zeigt sie einen Knopf an, der immer scheitert.
 */

export type SimulatorPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface SimulatorStatus {
  state: SimulatorPlaybackState;
  trackDescription: string | null;
  tickS: number;
  totalDurationS: number | null;
  speedFactor: number;
}

/** Der Simulator ist in dieser Installation nicht freigeschaltet. */
export class SimulatorDisabledError extends Error {
  constructor() {
    super(
      'Der GPS-Simulator ist gesperrt. Einschalten in Home Assistant unter ' +
        'Einstellungen → Add-ons → Yapaja Go → Konfiguration → „gps_simulator", ' +
        'danach das Add-on neu starten.',
    );
    this.name = 'SimulatorDisabledError';
  }
}

function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.replace(/\/$/, '')}/api/v1${path}`;
}

/**
 * Die Methode wird AUSDRUECKLICH mitgegeben und nicht aus „hat einen Rumpf?"
 * erschlossen.
 *
 * Genau daran ist die erste Fassung gescheitert: `pause` und `stop` brauchen
 * keinen Rumpf, sind aber POST-Routen -- die Ableitung schickte GET, der
 * Server antwortete 404, und in der Oberflaeche „passierte einfach nichts".
 * Eine Regel, die in vier von sechs Faellen stimmt, ist keine Regel.
 */
async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<SimulatorStatus> {
  const response = await fetch(apiUrl(path), {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (response.status === 403) throw new SimulatorDisabledError();

  if (!response.ok) {
    // Die Meldung des Servers durchreichen statt sie durch „Fehler" zu
    // ersetzen: sie nennt den Grund (etwa „Route ist nicht (mehr) bekannt"),
    // und der ist auf dem Bildschirm mehr wert als ein Statuscode.
    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Kein JSON -- dann bleibt es beim Statuscode.
    }
    throw new Error(message);
  }

  const data = (await response.json()) as { data: SimulatorStatus };
  return data.data;
}

export function fetchSimulatorStatus(): Promise<SimulatorStatus> {
  return call('GET', '/simulator/status');
}

/**
 * Faehrt die angegebene Route ab.
 *
 * Der Server leitet das Tempo je Abschnitt aus den Tempolimits der Route ab
 * (siehe `routeProfile.ts` im Core) -- der Browser schickt bewusst nur die
 * Routen-Kennung, damit die Zuordnung Abschnitt→Limit nicht an zwei Stellen
 * gerechnet wird.
 */
export function playRoute(routeId: string, speedFactor: number): Promise<SimulatorStatus> {
  return call('POST', '/simulator/play', { track: { routeId }, speed_factor: speedFactor });
}

export function pauseSimulator(): Promise<SimulatorStatus> {
  return call('POST', '/simulator/pause');
}

export function resumeSimulator(): Promise<SimulatorStatus> {
  // Ohne `track` heisst `play` „weiter", nicht „von vorn" -- so ist der
  // Endpunkt gebaut (siehe simulator/routes.ts).
  return call('POST', '/simulator/play', {});
}

export function stopSimulator(): Promise<SimulatorStatus> {
  return call('POST', '/simulator/stop');
}

/**
 * Stellt den Zeitraffer waehrend der Fahrt um.
 *
 * Eigener Endpunkt und NICHT `play` mit neuem Faktor: `play` beginnt immer
 * bei t=0, jeder Stufenwechsel haette also die Teststrecke von vorn
 * begonnen -- genau die Zeit, die der Zeitraffer sparen soll.
 */
export function setSimulatorSpeed(speedFactor: number): Promise<SimulatorStatus> {
  return call('POST', '/simulator/speed', { speed_factor: speedFactor });
}
