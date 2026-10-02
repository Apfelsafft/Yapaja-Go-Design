/* eslint-disable no-undef -- `AbortController`/`setTimeout` sind Standard-Globale
 * in Node 22; dieselbe Begruendung wie in ha/client.ts. */

/**
 * Freie Sätze über die KI von Home Assistant verstehen (0.30).
 *
 * Gewünscht: „Die Suche sollte nach Möglichkeit die KI-Funktionen von Home
 * Assistant nutzen, aber auch gerne bei Bedarf autark funktionieren."
 *
 * Autark ist `sprache/verstehen.ts`. Versteht das einen Satz NICHT und ist in
 * den Einstellungen ein Gesprächsagent gewählt (`conversation.*`, etwa ein
 * OpenAI-, Claude-, Google- oder Ollama-Agent), wird er gefragt -- aber nur
 * als Übersetzer: er soll den Satz in EINE der Absichten umformen, die
 * Yapaia kennt. Ausgeführt wird weiterhin nur durch Yapaia, mit denselben
 * Regeln (Routenstart erst nach „ja").
 *
 * Wirft nie. Keine Antwort, kein JSON oder eine unbekannte Absicht heißt:
 * nicht verstanden -- und das sagt Yapaia dann auch so.
 */

import type { HaConnection } from './config.js';
import { defaultHaFetch, type HaFetchLike } from './client.js';
import type { Absicht } from '../sprache/verstehen.js';
import { UNTERWEGS_KATEGORIEN } from '@yapaia/shared';

const KATEGORIEN = UNTERWEGS_KATEGORIEN.map((k) => `${k.id} (${k.name})`).join(', ');

export function kiAnweisung(satz: string): string {
  return [
    'Du übersetzt einen gesprochenen Befehl für das Wohnmobil-Navi „Yapaia" in JSON.',
    'Führe NICHTS aus und steuere keine Geräte. Antworte AUSSCHLIESSLICH mit genau einer Zeile JSON.',
    'Erlaubt sind nur diese Formen:',
    '{"art":"ziel","ort":"<Adresse oder Ort, so vollständig wie genannt>"}',
    `{"art":"naechste","kategorie":"<eine von: ${KATEGORIEN}>"}`,
    '{"art":"stopp"} {"art":"pause"} {"art":"weiter"} {"art":"ankunft"}',
    '{"art":"verkehr","anzahl":<1-5>} {"art":"ansagen","an":<true|false>}',
    '{"art":"unbekannt"}',
    `Befehl: ${satz}`,
  ].join('\n');
}

/** Das erste JSON-Objekt aus einem Text, als Absicht -- oder null. */
export function absichtAusText(text: string): Absicht | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.art) {
    case 'ziel':
      return typeof o.ort === 'string' && o.ort.trim().length >= 2 ? { art: 'ziel', ort: o.ort.trim() } : null;
    case 'naechste':
      return typeof o.kategorie === 'string' && UNTERWEGS_KATEGORIEN.some((k) => k.id === o.kategorie)
        ? { art: 'naechste', kategorie: o.kategorie }
        : null;
    case 'stopp':
    case 'pause':
    case 'weiter':
    case 'ankunft':
      return { art: o.art };
    case 'verkehr': {
      const n = typeof o.anzahl === 'number' ? Math.round(o.anzahl) : 1;
      return { art: 'verkehr', anzahl: Math.min(5, Math.max(1, n)) };
    }
    case 'ansagen':
      return typeof o.an === 'boolean' ? { art: 'ansagen', an: o.an } : null;
    default:
      return null;
  }
}

export async function frageKi(
  v: HaConnection,
  agentId: string,
  satz: string,
  deps: { fetch?: HaFetchLike; timeoutMs?: number } = {},
): Promise<Absicht | null> {
  const fetchImpl = deps.fetch ?? defaultHaFetch;
  const controller = new AbortController();
  const uhr = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
  try {
    const res = await fetchImpl(`${v.apiBase}/conversation/process`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: kiAnweisung(satz), language: 'de', agent_id: agentId }),
      signal: controller.signal,
    });
    if (!res.ok || !res.json) return null;
    const body = (await res.json()) as { response?: { speech?: { plain?: { speech?: unknown } } } };
    const text = body.response?.speech?.plain?.speech;
    return typeof text === 'string' ? absichtAusText(text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}
