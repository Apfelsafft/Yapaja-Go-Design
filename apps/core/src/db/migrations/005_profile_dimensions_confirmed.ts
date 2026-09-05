/**
 * 005_profile_dimensions_confirmed -- „hat ein Mensch diese Masse je
 * bestaetigt?" als eigener Zustand am Fahrzeugprofil.
 *
 * ─── WARUM DAS EINE SICHERHEITSFRAGE IST ────────────────────────────────────
 * Beim Anlegen der Datenbank entsteht ein Profil „Camper" mit
 * `height_m: 3.0` (siehe `profiles/service.ts`). Diese Zahl ist GERATEN --
 * die Anwendung kann das Fahrzeug nicht kennen. Sie sieht aber aus wie jede
 * andere: gespeichert, aktiv, und `buildTruckCostingOptions` reicht sie
 * unveraendert als `height` an Valhalla weiter.
 *
 * Erreichbar war dieser Zustand ohne jede Huerde:
 *
 *   * `isSkippable('profile')` ist WAHR -- der Fahrzeug-Schritt des
 *     Assistenten laesst sich ueberspringen (uebersprungen werden darf ab
 *     `region`, und `profile` kommt danach);
 *   * `selectNavigationAllowed` prueft ausschliesslich `hasValidConsent`,
 *     also den Haftungshinweis. Ueber die Masse sagt es nichts.
 *
 * Wer den Hinweis bestaetigt und den Fahrzeug-Schritt ueberspringt, faehrt
 * also mit geratenen Massen -- und nichts weist darauf hin. Bei einem
 * Wohnmobil mit 3,20 m plant die Route dann mit 3,00 m. Das sind 20 cm in
 * die gefaehrliche Richtung, und auffallen wuerde es unter einer Bruecke.
 *
 * ─── WARUM `NULL` FUER ALLE BESTEHENDEN ZEILEN ──────────────────────────────
 * Keine Vorgabe, kein Erraten. Ob jemand seine Masse schon einmal geprueft
 * hat, steht nirgends -- und die naheliegende Abkuerzung („weicht vom
 * Standardprofil ab, also wurde es bearbeitet") waere wieder eine Vermutung,
 * die als Tatsache auftritt. Genau das ist der Fehler, den diese Spalte
 * beheben soll.
 *
 * Der Preis ist ein einmaliger Hinweis auch fuer den, der seine Masse laengst
 * gesetzt hat. Der ist gering: ein Klick -- und er zwingt zu einem Blick auf
 * die Zahlen, mit denen wirklich geroutet wird. Genau darum geht es.
 *
 * Additiv, wie `README.md` es verlangt: `001`-`004` werden nicht angefasst.
 * Kein `NOT NULL`, kein `DEFAULT` -- `NULL` heisst „nie bestaetigt", und das
 * ist fuer Altbestand die einzige ehrliche Angabe.
 */

import type { Migration } from './types.js';

export const profileDimensionsConfirmed: Migration = {
  version: 5,
  name: '005_profile_dimensions_confirmed',
  up(db) {
    db.exec(`ALTER TABLE profiles ADD COLUMN dimensions_confirmed_at TEXT`);
  },
};
