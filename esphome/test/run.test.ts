/**
 * Die Prüfumgebung für die ESPHome-Anzeige — selbst geprüft.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Weil die Prüfumgebung einen Fehler durchgelassen hat, gegen den sie gebaut
 * war. Gemeldet vom Gerät, nach über tausend Übersetzungsschritten:
 *
 *   no known conversion for argument 1 from
 *   'esphome::homeassistant::HomeassistantSensor* const'
 *   to 'esphome::sensor::Sensor&'
 *
 * `run.mjs` übersetzte dieselbe Routine hier ohne Beanstandung. Der Grund war
 * nicht ein übersehener Fall, sondern ein falsches MODELL: die Prüfung bildete
 * `id(name)` als Objekt ab, weil `id(name).state` sonst nicht übersetzt hätte.
 * ESPHome macht es anders — es setzt die C++-Variable ein, und die ist bei
 * Komponenten ein ZEIGER; nur `id(name).` wird zu `name->`.
 *
 * Eine Prüfung, die eine Annahme nachbaut statt der Wirklichkeit, prüft die
 * Annahme. Sie ist dann schlimmer als keine, weil sie Sicherheit gibt, die es
 * nicht gibt.
 *
 * Die Umschreibung ist damit das Herzstück der ganzen Prüfung — und deshalb
 * steht sie jetzt selbst unter Aufsicht.
 *
 * ─── DIE QUELLE, NACHGELESEN STATT ANGENOMMEN ───────────────────────────────
 * `esphome/cpp_generator.py`, `process_lambda`:
 *
 *     if parts[i * 3 + 2] == ".":
 *         parts[i * 3 + 1] = var._      # ergibt "name->"
 *     else:
 *         parts[i * 3 + 1] = var        # ergibt "name"  -- der Zeiger
 *
 * `esphome/core/__init__.py`, `Lambda.comment_remover`: Kommentare werden vor
 * dem Suchen der Kennungen durch ein Leerzeichen ersetzt.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  idsUmschreiben,
  ohneKommentare,
  lambdaRumpf,
  substitutionen,
  ZEIGER_IDS,
  WERT_IDS,
} from './run.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const YAML = join(HIER, '..', 'yapaja-nav-display.yaml');

describe('idsUmschreiben — so, wie ESPHome es tut', () => {
  it('ein nacktes id(...) wird zum ZEIGER', () => {
    // Genau hier lag der Fehler: die alte Prüfung setzte hier ein Objekt ein.
    expect(idsUmschreiben('hat(id(yapaja_tempo))')).toBe('hat(yapaja_tempo)');
  });

  it('id(...) mit Punkt wird zum Pfeil', () => {
    expect(idsUmschreiben('id(yapaja_tempo).state')).toBe('yapaja_tempo->state');
  });

  it('eine Farbe ist ein WERT und behält ihren Punkt', () => {
    // `color:` erzeugt in ESPHome eine Variable (`cg.variable`), keinen
    // Zeiger (`cg.new_Pvariable`). Alles über einen Kamm zu scheren wäre
    // wieder ein Modell statt der Wirklichkeit.
    expect(idsUmschreiben('it.fill(id(c_hintergrund))')).toBe('it.fill(c_hintergrund)');
    expect(idsUmschreiben('id(c_text).r')).toBe('c_text.r');
  });

  it('verträgt Leerraum in den Klammern', () => {
    expect(idsUmschreiben('id( yapaja_tempo ).state')).toBe('yapaja_tempo->state');
  });

  it('bricht bei einer unbekannten Kennung ab, statt sie durchzulassen', () => {
    // Ohne das entstünde beim nächsten neuen Sensor genau dieselbe Lücke
    // noch einmal — eine Prüfung, die still an ihm vorbeiläuft.
    expect(() => idsUmschreiben('id(gibt_es_nicht).state')).toThrow(/weder als Zeiger noch als Wert/);
  });

  it('die beiden Listen überschneiden sich nicht', () => {
    // Eine Kennung, die in beiden stünde, bekäme die Behandlung der ersten
    // Abfrage — also eine, die von der Reihenfolge im Quelltext abhängt.
    for (const name of ZEIGER_IDS) {
      expect(WERT_IDS.has(name), name).toBe(false);
    }
  });
});

describe('ohneKommentare — so, wie ESPHome es tut', () => {
  it('entfernt einen Zeilenkommentar', () => {
    expect(ohneKommentare('int a; // weg\nint b;')).toBe('int a;  \nint b;');
  });

  it('lässt Zeichenketten unangetastet', () => {
    // Ein `//` in einer URL ist kein Kommentar.
    expect(ohneKommentare('print("https://x");')).toBe('print("https://x");');
  });

  it('erhält die Zeilenumbrüche', () => {
    // Sonst zeigten die Fehlermeldungen des Übersetzers auf die falsche
    // Zeile, und das ist beim Suchen eines Fehlers das Letzte, was man
    // gebrauchen kann.
    const roh = 'a;\n// weg\nb;\n// auch weg\nc;';
    expect(ohneKommentare(roh).split('\n')).toHaveLength(5);
  });

  it('ein id(...) im Kommentar zählt NICHT', () => {
    // Beim ersten Versuch ist genau das passiert: der Satz, der die Bedeutung
    // von `id(...)` erklärt, enthielt selbst ein solches Vorkommen — und die
    // Prüfung brach daran ab.
    expect(() => idsUmschreiben(ohneKommentare('// siehe id(irgendwas)\nint a;'))).not.toThrow();
  });
});

describe('Die ausgelieferte Konfiguration', () => {
  const text = readFileSync(YAML, 'utf-8');

  it('jede benutzte Kennung ist in run.mjs eingetragen', () => {
    // Läuft die Prüfung an einer Kennung vorbei, prüft sie etwas anderes als
    // das Gerät übersetzt. Das ist der Zustand, aus dem der gemeldete Fehler
    // entstanden ist.
    const fehlend: string[] = [];
    for (const treffer of ohneKommentare(text).matchAll(
      /id\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
    )) {
      const name = treffer[1];
      if (!ZEIGER_IDS.has(name) && !WERT_IDS.has(name)) fehlend.push(name);
    }
    expect(fehlend).toEqual([]);
  });

  it('die Hilfsfunktion `hat` nimmt einen Zeiger', () => {
    // Der gemeldete Fehler, als Eigenschaft festgehalten. Eine Referenz
    // übersetzt in einer Prüfumgebung, die `id()` als Objekt abbildet — auf
    // dem Gerät aber nicht.
    expect(text).toContain('auto hat = [](esphome::sensor::Sensor *s)');
    expect(text).not.toContain('auto hat = [](esphome::sensor::Sensor &s)');
  });
});

describe('die Wasserwaage laesst sich an EINER Stelle einstellen', () => {
  const yaml = (): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'yapaja-nav-display.yaml'), 'utf-8');

  it('alle Einstellungen stehen unter `substitutions:`', () => {
    // Gewuenscht war ausdruecklich: „an einer Stelle zu pflegen". Wer eine
    // dieser Zahlen spaeter in die Zeichenroutine schreibt, macht aus einer
    // Einstellung eine Suchaufgabe.
    const werte = substitutionen(yaml());
    for (const name of [
      'entity_neigung_lr',
      'entity_neigung_vh',
      'wasserwaage_ab_kmh',
      'wasserwaage_gerade_grad',
      'wasserwaage_bereich_grad',
      'neigung_lr_vorzeichen',
      'neigung_vh_vorzeichen',
    ]) {
      expect(werte[name], name).toBeDefined();
    }
  });

  it('das VORZEICHEN wirkt sich wirklich aus', () => {
    // ─── DIE MUTATION, DIE ZUERST UEBERLEBT HAT ───────────────────────────
    // Der Multiplikator liess sich streichen, ohne dass ein Test rot wurde --
    // weil alle Pruefstands-Faelle mit `1` laufen und eine Multiplikation
    // mit 1 nichts aendert.
    //
    // Das ist ausgerechnet die wichtigste Einstellung dieser Anzeige: eine
    // spiegelverkehrte Wasserwaage schickt den Auffahrkeil unter das falsche
    // Rad. Geprueft wird deshalb, dass ein geaenderter Wert im erzeugten
    // C++ WIRKLICH ankommt.
    // ─── UND WARUM JEDE ACHSE EINZELN ──────────────────────────────────
    // Der erste Entwurf dieser Pruefung tauschte BEIDE Vorzeichen und sah
    // nach, ob irgendwo ein `-1` steht. Damit ueberlebte die Mutation
    // weiterhin: faellt der Multiplikator bei LINKS/RECHTS weg, liefert der
    // von VORNE/HINTEN das gesuchte `-1` -- und die Pruefung war zufrieden.
    //
    // Ein Test, der zwei Dinge zugleich prueft, prueft am Ende eines.
    for (const achse of ['lr', 'vh'] as const) {
      const geaendert = yaml().replace(
        `neigung_${achse}_vorzeichen: "1"`,
        `neigung_${achse}_vorzeichen: "-1"`,
      );
      expect(geaendert, `${achse}: die Ersetzung selbst hat nicht gegriffen`).not.toBe(yaml());

      const zeile = lambdaRumpf(geaendert)
        .split('\n')
        .find((z) => z.includes(`const float ${achse} =`));
      expect(zeile, `${achse}: die Zeile gibt es nicht mehr`).toBeDefined();
      expect(zeile, `${achse}: das Vorzeichen kommt nicht an`).toContain('(float) (-1)');
    }

    // Die Gegenprobe: mit der Vorgabe steht dort kein Minus.
    expect(lambdaRumpf(yaml())).not.toContain('(float) (-1)');
  });

  it('keine Zahl der Wasserwaage steht doppelt im Quelltext', () => {
    // Eine Einstellung, die auch fest im Code steht, laeuft frueher oder
    // spaeter mit sich selbst auseinander.
    const rumpf = lambdaRumpf(yaml());
    // Die Zeichenroutine darf die Entitaetsnamen nicht kennen -- sie kommen
    // ueber `id(...)`, nicht als Text.
    expect(rumpf).not.toContain('sensor.heizung');
  });
});
