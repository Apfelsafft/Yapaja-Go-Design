/**
 * Quellen-Prüfung (`feat/gui-install-path`).
 *
 * WOZU: Der Regionen-Katalog verwies auf `.pmtiles`-URLs, die es nie gab
 * (404). Aufgefallen ist das erst, als jemand sie im Browser aufrief — die
 * App selbst meldete nur „Download fehlgeschlagen". Diese Prüfung macht
 * genau das aus der GUI heraus möglich: EINE URL anfragen und berichten,
 * was tatsächlich zurückkommt (HTTP-Status, Content-Type, Größe,
 * Range-Unterstützung) und ob die ersten Bytes überhaupt eine PMTiles-Datei
 * sind.
 *
 * WIE: Ein GET mit `Range: bytes=0-127`. Bewusst kein HEAD -- viele Server
 * (und jeder statische Objektspeicher hinter einer CDN-Regel) beantworten
 * HEAD anders als GET, und HEAD liefert vor allem die ERSTEN BYTES nicht,
 * ohne die sich „ist das wirklich eine PMTiles-Datei?" nicht beantworten
 * lässt. Die Antwort wird nach 128 Bytes abgebrochen, es wird also auch bei
 * einem Server ohne Range-Unterstützung nie ein 4-GB-Body geladen.
 *
 * Der Rückgabewert ist ABSICHTLICH rein beschreibend (Status/Header/Bytes).
 * Die Bewertung („taugt diese Quelle?") und ihre deutsche Formulierung
 * passieren eine Ebene höher, damit dieselbe Prüfung auch für einen
 * `.osm.pbf` benutzt werden kann, bei dem eine PMTiles-Signatur gerade
 * NICHT erwartet wird.
 */

import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';
import { Buffer } from 'node:buffer';

/** Wie viele Bytes vom Anfang der Datei betrachtet werden. Die
 *  PMTiles-v3-Signatur steckt in den ersten beiden. */
export const PROBE_PREFIX_BYTES = 128;

/** Kurzer Timeout: die Prüfung läuft synchron zu einem GUI-Klick. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  url: string;
  /** true, wenn überhaupt eine HTTP-Antwort kam (auch ein 404 ist `true`). */
  reachable: boolean;
  httpStatus: number | null;
  contentType: string | null;
  /** Gesamtgröße, aus `Content-Range` (bei 206) oder `Content-Length`. */
  contentLengthBytes: number | null;
  /** Server beantwortet `Range` mit 206 -- Voraussetzung für einen
   *  fortsetzbaren Download eines mehrere GB grossen Extrakts. */
  supportsRange: boolean;
  /** Erste Bytes beginnen mit der PMTiles-v3-Signatur `PM`. */
  looksLikePmtiles: boolean;
  /** Erste Bytes sehen nach HTML aus -- der klassische Fall „Server
   *  antwortet 200 mit einer Fehlerseite statt der Datei". */
  looksLikeHtml: boolean;
  /** Transportfehler (DNS, TLS, Timeout, Verbindung abgelehnt). */
  error: string | null;
}

function requestFn(url: string): typeof http.request {
  return url.startsWith('https:') ? https.request : http.request;
}

/** `bytes 0-127/12345` -> 12345. Gibt null zurück, wenn der Header fehlt
 *  oder unbekannt ist (`*` als Gesamtgröße ist erlaubt). */
export function parseTotalFromContentRange(header: string | undefined): number | null {
  if (!header) return null;
  const match = /\/(\d+)\s*$/.exec(header);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/** Pure Hilfsfunktion (unit-getestet): Auswertung des gelesenen Präfixes. */
export function classifyPrefix(prefix: Buffer): { looksLikePmtiles: boolean; looksLikeHtml: boolean } {
  const looksLikePmtiles = prefix.length >= 2 && prefix[0] === 0x50 && prefix[1] === 0x4d; // "PM"
  const head = prefix.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
  const looksLikeHtml = head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml');
  return { looksLikePmtiles, looksLikeHtml };
}

/**
 * Fragt `url` an und berichtet, was zurückkam. Wirft nie -- ein
 * Transportfehler landet in `error`, damit die GUI ihn anzeigen kann,
 * statt dass der Aufrufer einen 500er bekommt.
 */
export function probeSource(url: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    url,
    reachable: false,
    httpStatus: null,
    contentType: null,
    contentLengthBytes: null,
    supportsRange: false,
    looksLikePmtiles: false,
    looksLikeHtml: false,
    error: null,
  };

  return new Promise<ProbeResult>((resolvePromise) => {
    let settled = false;
    const settle = (result: ProbeResult): void => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };

    let request: ReturnType<typeof http.request>;
    try {
      request = requestFn(url)(
        url,
        { headers: { Range: `bytes=0-${PROBE_PREFIX_BYTES - 1}` }, timeout: PROBE_TIMEOUT_MS },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
          const contentRangeTotal = parseTotalFromContentRange(
            typeof res.headers['content-range'] === 'string' ? res.headers['content-range'] : undefined,
          );
          const contentLengthHeader = res.headers['content-length'];
          const contentLength =
            typeof contentLengthHeader === 'string' ? Number.parseInt(contentLengthHeader, 10) : null;

          const chunks: Buffer[] = [];
          let read = 0;

          const finish = (): void => {
            const prefix = Buffer.concat(chunks).subarray(0, PROBE_PREFIX_BYTES);
            const { looksLikePmtiles, looksLikeHtml } = classifyPrefix(prefix);
            settle({
              ...base,
              reachable: true,
              httpStatus: status,
              contentType,
              // Bei 206 ist `Content-Length` nur die Länge des Teilstücks --
              // die echte Gesamtgröße steht in `Content-Range`.
              contentLengthBytes:
                contentRangeTotal ?? (contentLength !== null && Number.isFinite(contentLength) ? contentLength : null),
              supportsRange: status === 206,
              looksLikePmtiles,
              looksLikeHtml,
            });
          };

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            read += chunk.length;
            if (read >= PROBE_PREFIX_BYTES) {
              // Genug gesehen: Verbindung abbrechen, damit ein Server ohne
              // Range-Unterstützung nicht die ganze Datei schickt.
              res.destroy();
              request.destroy();
              finish();
            }
          });
          res.on('end', finish);
          res.on('error', () => finish());
        },
      );
    } catch (err) {
      // Eine unparsbare URL wirft schon beim Aufbau der Anfrage.
      settle({ ...base, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    request.on('timeout', () => {
      request.destroy(new Error(`Zeitüberschreitung nach ${PROBE_TIMEOUT_MS} ms`));
    });
    request.on('error', (err) => {
      settle({ ...base, error: err instanceof Error ? err.message : String(err) });
    });
    request.end();
  });
}
