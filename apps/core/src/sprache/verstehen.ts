/**
 * Was ein gesprochener Satz bedeutet -- ohne KI, ohne Netz.
 *
 * Gewünscht: „Bitte fahre mich zur Ziolkowskistraße nach Magdeburg", „Wo ist
 * die nächste Tankstelle?", „Stoppe Navigation", „Lies mir die nächste
 * Verkehrsinfo auf der Route vor". Und: „sollte nach Möglichkeit die
 * KI-Funktionen von Home Assistant nutzen, aber auch gerne bei Bedarf autark
 * funktionieren."
 *
 * Diese Datei ist der autarke Teil: feste Satzmuster für die häufigen
 * Befehle. Eine KI (über Home Assistant) kommt erst dazu, wenn hier nichts
 * passt -- siehe `dialog.ts`. So bleibt das Wichtige verlässlich, auch im
 * Funkloch.
 *
 * Spracherkennung schreibt, was sie hört: Groß/klein, Satzzeichen und
 * Füllwörter („bitte", „mal") sind beliebig. Deshalb wird zuerst geglättet.
 */

import { UNTERWEGS_KATEGORIEN } from '@yapaia/shared';

export type Absicht =
  | { art: 'ziel'; ort: string }
  | { art: 'naechste'; kategorie: string }
  | { art: 'naechste_name'; name: string }
  | { art: 'stopp' }
  | { art: 'pause' }
  | { art: 'weiter' }
  | { art: 'verkehr'; anzahl: number }
  | { art: 'ankunft' }
  | { art: 'ansagen'; an: boolean }
  | { art: 'ja' }
  | { art: 'nein' }
  | { art: 'wahl'; nummer: number }
  | { art: 'hilfe' }
  | { art: 'unbekannt'; text: string };

/** Wie Spracherkennung „Yapaia" schreibt -- und das Wort davor weg. */
const ANREDE = /^(?:(?:hey|hallo|ok(?:ay)?)\s+)?(?:yapaia|yapaja|japaja|japaia|yapaya|japaya|ja\s*paja|navi)\b[\s,:]*/;

/** Glätten: klein, ohne Satzzeichen, ohne Anrede und Füllwörter. */
export function glaetten(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[„“"'!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(ANREDE, '').trim();
  t = t.replace(/\b(bitte|mal|doch|jetzt|gerne?|kannst du|könntest du|würdest du|du)\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Stichwörter je „Unterwegs"-Kategorie. Die erste passende gewinnt. */
const KATEGORIE_WOERTER: ReadonlyArray<[string, RegExp]> = [
  ['fuel', /tank(stelle|en)?|sprit|diesel|benzin|zapfsäule/],
  ['sanitary_dump_station', /entsorg|grauwasser|schwarzwasser|chemie ?klo|kassette/],
  ['water_point', /frischwasser|wasser ?(auffüllen|tanken|stelle)|trinkwasser/],
  ['caravan_site', /stellplatz|wohnmobil ?(stell)?platz|übernacht|schlafplatz/],
  ['camp_site', /camping/],
  ['parking', /parkplatz|parken|rastplatz/],
  ['supermarket', /supermarkt|einkauf|lebensmittel|laden/],
  ['gas', /gas(flasche|tausch)?|propan|lpg/],
  ['toilets', /toilette|klo|wc/],
];

export function kategorieAus(text: string): string | null {
  for (const [id, re] of KATEGORIE_WOERTER) if (re.test(text)) return id;
  return null;
}

const ZAHLWORT: Readonly<Record<string, number>> = {
  ersten: 1, erste: 1, eins: 1, erstes: 1,
  zweiten: 2, zweite: 2, zwei: 2, zweites: 2,
  dritten: 3, dritte: 3, drei: 3, drittes: 3,
  vierten: 4, vierte: 4, vier: 4,
  fünften: 5, fünfte: 5, fünf: 5,
};

/**
 * Aus „zur Ziolkowskistraße nach Magdeburg" wird „Ziolkowskistraße Magdeburg".
 * Die Verbindungswörter stehen in keinem Namen und würden die Suche leeren.
 */
export function ortAus(rest: string): string {
  return rest
    .replace(/\b(zu[mr]?|nach|in|im|in die|in den|ins|bis|an die|an den|zum|zur|der|die|das|dem|den|richtung|hin|bringen|fahren|navigieren|führen)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aus „finde den nächsten Aldi in der Nähe" wird „aldi". */
export function nameAus(t: string): string {
  return t
    .replace(/\b(in der nähe|um die ecke|von hier( aus)?|hier)\b/g, ' ')
    .replace(
      /\b(wo|ist|gibt|es|finde ich|find\w*|such\w*|zeig\w*|fahre?|fahr\w*|bring\w*|navigier\w*|führ\w*|lotse?|ich|wir|brauche\w*|will|wollen|möchte\w*|mich|uns|mir|der|die|das|den|dem|des|zu[mr]?|nach|ein|eine|einen|einem|einer|nächst\w*|nächstgelegen\w*|gelegen\w*|liegt|befindet sich)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function verstehe(roh: string): Absicht {
  const t = glaetten(roh);
  if (!t) return { art: 'unbekannt', text: roh };

  // ─── KURZE ANTWORTEN AUF EINE RÜCKFRAGE ─────────────────────────────────
  if (/^(ja|jawohl|genau|okay|ok|los|fahr los|starte?|start|mach das|mach|klar|passt|gerne|gern)( los| die navigation| navigation)?$/.test(t)) {
    return { art: 'ja' };
  }
  if (/^(nein|nee|nö|abbrechen|vergiss es|lass( es)?|doch nicht)$/.test(t)) return { art: 'nein' };
  const wahl = t.match(/^(?:nimm |den |die |das |nummer |option )*(\d|ersten|erste|erstes|zweiten|zweite|zweites|dritten|dritte|drittes|vierten|vierte|fünften|fünfte|eins|zwei|drei|vier|fünf)\b/);
  if (wahl && t.split(' ').length <= 3) {
    const n = /^\d$/.test(wahl[1]!) ? Number(wahl[1]) : ZAHLWORT[wahl[1]!];
    if (n) return { art: 'wahl', nummer: n };
  }

  // ─── NAVIGATION STEUERN ─────────────────────────────────────────────────
  if (/\b(stopp?e?|stop|beende|beenden|abbrechen|brich)\b.*\b(navi|navigation|führung|route|fahrt)\b|\b(navi|navigation|route|führung)\b.*\b(stopp?en|beenden|abbrechen|aus)\b|^(stopp?|halt|ende|anhalten)$/.test(t)) {
    return { art: 'stopp' };
  }
  if (/\b(pausier\w*|pause|unterbrech\w*)\b/.test(t)) return { art: 'pause' };
  if (/\b(weiter(fahren|machen)?|fortsetzen|setze? fort|navigation weiter)\b/.test(t) && !/\bwie weit\b/.test(t)) {
    return { art: 'weiter' };
  }

  // ─── ANSAGEN ────────────────────────────────────────────────────────────
  if (/\b(ansage\w*|sprach ?ausgabe|stimme)\b/.test(t)) {
    if (/\b(aus|stumm|ruhig|abschalten|ausschalten|leise)\b/.test(t)) return { art: 'ansagen', an: false };
    if (/\b(an|ein|einschalten|anschalten)\b/.test(t)) return { art: 'ansagen', an: true };
  }
  if (/^(sei )?(still|ruhe|ruhig)$/.test(t)) return { art: 'ansagen', an: false };

  // ─── VERKEHR VORLESEN ───────────────────────────────────────────────────
  if (/\b(verkehr\w*|stau\w*|baustelle\w*|sperrung\w*|meldung\w*)\b/.test(t)) {
    const alle = /\b(alle|die nächsten|mehrere|liste)\b/.test(t);
    const zahl = t.match(/\b(zwei|drei|vier|fünf|\d)\b/);
    const n = zahl ? (/^\d$/.test(zahl[1]!) ? Number(zahl[1]) : (ZAHLWORT[zahl[1]!] ?? 1)) : alle ? 3 : 1;
    return { art: 'verkehr', anzahl: Math.min(5, Math.max(1, n)) };
  }

  // ─── ANKUNFT ────────────────────────────────────────────────────────────
  if (/\b(wann (sind|kommen|bin)|ankunft|wie (lange|weit) (noch|ist es)|wie lange|wie weit|restzeit|eta)\b/.test(t)) {
    return { art: 'ankunft' };
  }

  // ─── HILFE ──────────────────────────────────────────────────────────────
  if (/^(hilfe|was kannst|was geht|befehle)/.test(t)) return { art: 'hilfe' };

  // ─── NÄCHSTE TANKSTELLE … ───────────────────────────────────────────────
  // Vor dem Ziel geprüft: „fahre mich zur nächsten Tankstelle" ist eine
  // Suche nach der nächsten, kein Ortsname „nächste Tankstelle".
  if (/\b(nächst\w*|nächstgelegen\w*|in der nähe|nahe|um die ecke)\b|^(wo|such\w*|find\w*|zeig\w*|brauche?|wir brauchen|ich brauche)\b/.test(t)) {
    const kat = kategorieAus(t);
    if (kat) return { art: 'naechste', kategorie: kat };
  }
  // „Finde den nächsten Aldi", „wo ist hier ein Lidl": ein NAME statt einer
  // Kategorie. Nur mit „nächst…"/„in der Nähe"/„wo ist ein" -- „fahr zu
  // Aldi" allein bleibt ein Ziel.
  if (/\b(nächst\w*|nächstgelegen\w*|in der nähe|um die ecke)\b|^wo (ist|gibt es|finde ich) (hier )?(ein|eine|einen)\b/.test(t)) {
    const name = nameAus(t);
    if (name.length >= 2) return { art: 'naechste_name', name };
  }

  // ─── ZIEL ───────────────────────────────────────────────────────────────
  const ziel = t.match(
    /^(?:fahre?|fahr|bring\w*|navigier\w*|führ\w*|route|lotse?|ich will|ich möchte|wir wollen|wir möchten)(?:\s+(?:mich|uns))?(?:\s+(?:bitte))?\s+(.+)$/,
  );
  if (ziel) {
    const ort = ortAus(ziel[1]!);
    if (ort.length >= 3) return { art: 'ziel', ort };
  }
  const nach = t.match(/^(?:nach|zu[mr]?)\s+(.+)$/);
  if (nach) {
    const ort = ortAus(nach[1]!);
    if (ort.length >= 3) return { art: 'ziel', ort };
  }

  return { art: 'unbekannt', text: t };
}

/** Der deutsche Name einer Kategorie, für die Antwort. */
export function kategorieName(id: string): string {
  return UNTERWEGS_KATEGORIEN.find((k) => k.id === id)?.name ?? id;
}
