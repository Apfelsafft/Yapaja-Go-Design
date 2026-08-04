/**
 * RSS-/FD-Erhebung eines LOKALEN Prozesses ueber `/proc`.
 *
 * Bewusst KEIN neuer Parser: `parseProcStat` stammt aus
 * `apps/core/src/addons/watchdog.ts` (E09-T3) und wird hier wiederverwendet --
 * es gibt genau eine Stelle im Repo, die `/proc/<pid>/stat` zerlegt.
 *
 * Grenze dieser Datei, ausdruecklich: sie misst PROZESSE auf DIESEM Host.
 * Sie misst KEINE Container. Fuer Valhalla/Photon/gpsd gibt es in der
 * per-PR-Pipeline keinen laufenden Prozess, den man hier adressieren
 * koennte -- deren RSS wird deshalb in `90-rss.spec.ts` als `not_measured`
 * mit Begruendung ausgewiesen und nicht geschaetzt.
 */

import { readFileSync, readdirSync, readlinkSync } from 'fs';
import { parseProcStat } from '../../../apps/core/src/addons/watchdog.js';

/** Seitengroesse in Bytes; auf x86-64/Linux 4096 (wie im Add-on-Watchdog). */
const PAGE_SIZE = 4096;

export interface ProcSample {
  readonly rssBytes: number;
  readonly rssMb: number;
  /** Anzahl offener Dateideskriptoren; 0, wenn `/proc/<pid>/fd` nicht lesbar ist. */
  readonly fdCount: number;
  /** Davon Sockets (HTTP-/WS-Verbindungen) -- hier werden Verbindungslecks sichtbar. */
  readonly socketCount: number;
  /** false, wenn die fd-Zaehlung nicht moeglich war (dann sind die beiden Zahlen oben 0). */
  readonly fdReadable: boolean;
}

export function procAvailable(): boolean {
  try {
    readFileSync('/proc/self/stat', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Eine Momentaufnahme. Gibt `null` zurueck, wenn der Prozess weg ist oder es
 * kein `/proc` gibt -- niemals einen geratenen Wert.
 */
export function sampleProcess(pid: number): ProcSample | null {
  let statRaw: string;
  try {
    statRaw = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseProcStat(statRaw);
  if (!parsed) return null;

  let fdCount = 0;
  let socketCount = 0;
  let fdReadable = true;
  try {
    const fds = readdirSync(`/proc/${pid}/fd`);
    fdCount = fds.length;
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith('socket:')) {
          socketCount += 1;
        }
      } catch {
        // Ein fd kann zwischen readdir und readlink verschwinden -- kein Fehler.
      }
    }
  } catch {
    fdReadable = false;
    fdCount = 0;
    socketCount = 0;
  }

  const rssBytes = parsed.rssPages * PAGE_SIZE;
  return {
    rssBytes,
    rssMb: rssBytes / (1024 * 1024),
    fdCount,
    socketCount,
    fdReadable,
  };
}
