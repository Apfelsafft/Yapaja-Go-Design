/**
 * 006_profile_tempo100_fuel -- Tempo-100-Zulassung und Spritsorte werden
 * wirklich gespeichert.
 *
 * ─── DER FEHLER, DEN DAS BEHEBT ─────────────────────────────────────────────
 * `tempo_100` gibt es seit 0.14.0 am Profil, im Editor und in der
 * Tempowarnung -- aber nie in der Tabelle. `profileToRow` liess es weg, die
 * UPDATE-Anweisung auch. Wer die Zulassung eintrug, sah sie gespeichert, und
 * nach dem nächsten Laden war sie weg: über 3,5 t warnte Yapaia dann auf der
 * Autobahn bei 80 statt 100. Die vorsichtige Richtung, aber eine Angabe, die
 * still verschwindet, ist trotzdem falsch.
 *
 * Aufgefallen beim Einbau der Spritsorte (gewünscht: „Kannst du bitte im
 * Profil auch noch die Spritsorte einstellbar machen?"), die denselben Weg
 * nehmen muss.
 *
 * ─── WARUM `NULL` FÜR DEN ALTBESTAND ────────────────────────────────────────
 * `tempo_100`: ohne Zulassung gilt die niedrigere Grenze. NULL wird als
 * „nein" gelesen, wie bisher auch -- an alten Profilen ändert sich nichts.
 * `fuel_type`: NULL heisst „nicht angegeben", und dann wird bei Tankstellen
 * nichts ausgefiltert.
 *
 * Additiv, wie `README.md` es verlangt.
 */

import type { Migration } from './types.js';

export const profileTempo100Fuel: Migration = {
  version: 6,
  name: '006_profile_tempo100_fuel',
  up(db) {
    db.exec(`ALTER TABLE profiles ADD COLUMN tempo_100 INTEGER`);
    db.exec(`ALTER TABLE profiles ADD COLUMN fuel_type TEXT`);
  },
};
