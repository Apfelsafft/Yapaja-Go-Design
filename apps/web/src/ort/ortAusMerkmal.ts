/**
 * Aus einem getroffenen Kartenmerkmal einen `GewaehlterOrt` machen.
 *
 * Zwei Quellen liegen auf der Karte, mit verschiedenen Feldern:
 *  - `poi-labels` (Vektorkacheln, OpenMapTiles): `name`, `class`, `subclass`.
 *  - Sonderziele aus dem Suchindex: `name`, `bezeichnung`, `symbol`,
 *    `adresse`, `ort` (`map/sonderzieleClient.ts`).
 *
 * Die Kategorie wird nur genannt, wenn Yapaia sie kennt -- ein roher
 * OSM-Wert wie „fast_food" wäre auf der Karte eine Auskunft in einer
 * fremden Sprache.
 */

import { POI_KATEGORIEN } from '@yapaia/shared';
import type { GewaehlterOrt } from './ortStore.js';

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function kategorieAusKachel(
  klasse: string | null,
  unterklasse: string | null,
): { name: string; symbol: string } | null {
  if (!klasse) return null;
  const k = POI_KATEGORIEN.find(
    (kat) =>
      kat.klassen.includes(klasse) &&
      (!kat.unterklassen || (unterklasse !== null && kat.unterklassen.includes(unterklasse))),
  );
  return k ? { name: k.name, symbol: k.symbol } : null;
}

export function ortAusMerkmal(
  eigenschaften: Record<string, unknown> | null | undefined,
  punkt: { lat: number; lon: number },
  sprache?: string,
): GewaehlterOrt | null {
  const p = eigenschaften ?? {};
  const name = (sprache ? text(p[`name:${sprache}`]) : null) ?? text(p.name);
  const symbol = text(p.symbol);
  const bezeichnung = text(p.bezeichnung);

  let kategorie: string | null = null;
  let sym: string | null = symbol;
  if (bezeichnung) {
    kategorie = bezeichnung;
  } else {
    const k = kategorieAusKachel(text(p.class), text(p.subclass));
    if (k) {
      kategorie = k.name;
      sym = sym ?? k.symbol;
    }
  }

  // Ohne Namen und ohne Kategorie ist nichts da, was eine Karte rechtfertigt.
  if (!name && !kategorie) return null;

  const adresse = [text(p.adresse), text(p.ort)].filter(Boolean).join(', ') || null;
  return { lat: punkt.lat, lon: punkt.lon, name, kategorie, symbol: sym, adresse };
}
