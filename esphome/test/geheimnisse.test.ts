/**
 * `api:` und `ota:` — die Form, die der Device Builder erwartet, und kein
 * echter Schlüssel im Repository.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * Mit Bildschirmfoto aus dem laufenden Gerät (Device Builder 1.14.9, ESPHome
 * 2026.9.0):
 *
 *     api:
 *       encryption:
 *         key: <eingetragen>
 *
 *     ota:
 *       - platform: esphome
 *
 * In dieser Datei standen bis 0.13.1 dagegen zwei `!secret`-Verweise:
 * `yapaja_display_api_key` und `yapaja_display_ota_password`. Für eine von
 * Hand gepflegte Konfiguration ist das richtig. Für den Device Builder ist es
 * falsch: der erzeugt den Schlüssel selbst und trägt ihn ein, und er legt
 * KEINEN der beiden Einträge in `secrets.yaml` an. Wer die Datei übernahm,
 * bekam Verweise auf nicht vorhandene Einträge — und nichts übersetzte.
 *
 * ─── WARUM DAS GEPRÜFT WIRD UND NICHT NUR KORRIGIERT ────────────────────────
 * Zwei verschiedene Gründe, die zufällig dieselbe Datei betreffen.
 *
 * Der erste ist Bequemlichkeit: die Form soll zu der passen, die der Device
 * Builder erzeugt, damit niemand vor dem ersten Übersetzen etwas nachtragen
 * muss.
 *
 * Der zweite ist ernster. Beim nächsten Abgleich mit einem laufenden Gerät
 * ist ein echter Schlüssel schnell mitkopiert — er steht dort ja genau an
 * dieser Stelle. Ein Geräteschlüssel im Quelltext wäre auf jedem Gerät
 * derselbe und läge offen. Diese Prüfung ist die Stelle, die das bemerkt,
 * bevor es jemand tut.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const YAML = join(HIER, '..', 'yapaja-nav-display.yaml');

function text(): string {
  return readFileSync(YAML, 'utf-8');
}

/**
 * Nur die Zeilen, die ESPHome wirklich liest — Kommentare heraus.
 *
 * ─── WARUM DIESE UNTERSCHEIDUNG SEIN MUSS ───────────────────────────────────
 * Der erste Entwurf dieser Prüfung suchte im ganzen Text und wurde prompt
 * rot: die beiden alten Namen stehen weiterhin in der Datei — im Kommentar,
 * der erklärt, was dort früher stand und warum es stört.
 *
 * Ein Wächter, der das verbietet, verbietet die Begründung. Dann verschwindet
 * beim nächsten Mal der Kommentar statt des Fehlers, und die Erfahrung ist
 * weg. Geprüft wird deshalb, was ESPHome sieht.
 */
function ohneKommentare(): string {
  return text()
    .split('\n')
    .filter((zeile) => !zeile.trim().startsWith('#'))
    .join('\n');
}

/** Der Platzhalter für den Fall, dass der Device Builder den Schlüssel setzt. */
const PLATZHALTER = 'ERZEUGT_DER_DEVICE_BUILDER';

/** Die Anleitung, die dieselben Namen nennen muss. */
function readme(): string {
  return readFileSync(join(HIER, '..', 'README.md'), 'utf-8');
}

/** Der Name hinter `!secret` in der `key:`-Zeile, oder `null`. */
function schluesselGeheimnis(): string | null {
  const zeile = ohneKommentare().match(/^\s*key:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const treffer = zeile.match(/^!secret\s+(\S+)$/);
  return treffer?.[1] ?? null;
}

describe('api: — die Form aus dem Device Builder', () => {
  it('hat einen Verschlüsselungsschlüssel', () => {
    // Ohne `encryption:` liesse das Geraet jeden herein, der es im Netz
    // erreicht — und dieses hier haengt in einem Fahrzeug-WLAN.
    expect(ohneKommentare()).toMatch(/^api:\n\s+encryption:\n\s+(#.*\n\s+)*key:/m);
  });

  it('enthält KEINEN echten Schlüssel', () => {
    // ─── WAS HIER GESUCHT WIRD ──────────────────────────────────────────────
    // ESPHome erzeugt 32 Byte base64, also 44 Zeichen mit `=` am Ende. Genau
    // danach wird gesucht: alles, was so aussieht, ist einer.
    const zeile = ohneKommentare().match(/^\s*key:\s*(.+)$/m)?.[1]?.trim() ?? '';
    expect(zeile, 'im key: steht etwas, das wie ein echter Schlüssel aussieht').not.toMatch(
      /^["']?[A-Za-z0-9+/]{43}=["']?$/,
    );
  });

  it('der Platzhalter ist als solcher erkennbar', () => {
    // Ein Platzhalter, der wie ein Wert aussieht, wird stehen gelassen.
    const zeile = ohneKommentare().match(/^\s*key:\s*(.+)$/m)?.[1]?.trim() ?? '';
    expect(zeile === PLATZHALTER || zeile.startsWith('!secret ')).toBe(true);
  });
});

describe('ota: — ohne Passwort, wie der Device Builder es anlegt', () => {
  it('ist eine Liste mit `platform: esphome`', () => {
    // Die Listenform ist seit ESPHome 2024.6 die richtige. Die alte Schreibweise
    // (`ota:` mit `password:` direkt darunter) uebersetzt nicht mehr.
    expect(ohneKommentare()).toMatch(/^ota:\n\s+- platform: esphome\s*$/m);
  });

  it('hat KEINE `password:`-Zeile', () => {
    // Genau diese Zeile verwies auf einen Eintrag, den der Device Builder
    // nicht anlegt. OTA ist durch den API-Schluessel geschuetzt.
    const ota = ohneKommentare().split(/^ota:/m)[1]?.split(/^\w/m)[0] ?? '';
    expect(ota).not.toMatch(/password:/);
  });
});

describe('die Datei verweist auf keine Geheimnisse, die niemand anlegt', () => {
  it('nennt weder `yapaja_display_api_key` noch `yapaja_display_ota_password`', () => {
    // Die beiden Namen gab es nur in dieser Datei und in der Anleitung. Wer
    // einen davon wieder einbaut, bricht den Weg über den Device Builder —
    // und zwar erst beim Übersetzen, auf dem Gerät des Betreibers.
    for (const name of ['yapaja_display_api_key', 'yapaja_display_ota_password']) {
      expect(ohneKommentare(), `${name} ist wieder da`).not.toContain(name);
    }
  });

  it('jeder `!secret`-Verweis steht auch in der Anleitung', () => {
    // ─── DIE PANNE, DIE DAS VERHINDERT ──────────────────────────────────────
    // Bis 0.13.1 verwies diese Datei auf `yapaja_display_api_key` und
    // `yapaja_display_ota_password`. Beide gab es nirgends: der Device
    // Builder legt sie nicht an, und wer die Datei uebernahm, bekam Verweise
    // ins Leere — bemerkt erst beim Uebersetzen auf dem eigenen Geraet.
    //
    // Die Regel dagegen ist einfach: was diese Datei per `!secret` verlangt,
    // muss in der Anleitung stehen, damit es jemand anlegen KANN. Geprüft
    // wird die Richtung, die schiefgehen kann — ein Name in der YAML ohne
    // Entsprechung in der Anleitung.
    const verlangt = [...ohneKommentare().matchAll(/!secret\s+(\S+)/g)].map((m) => m[1]);
    expect(verlangt.length, 'gar keine Geheimnisse? dann prüft das hier nichts').toBeGreaterThan(0);
    for (const name of verlangt) {
      expect(readme(), `${name} wird verlangt, steht aber in keiner Anleitung`).toContain(
        name as string,
      );
    }
  });

  it('der API-Schlüssel kommt aus `secrets.yaml`', () => {
    // So gewünscht. Die Prüfung oben liesse auch den Device-Builder-Weg zu;
    // diese hier hält fest, wofür sich der Betreiber entschieden hat — und
    // dass der Name beim nächsten Abgleich mit einem laufenden Gerät nicht
    // versehentlich durch den echten Schlüssel ersetzt wird.
    expect(schluesselGeheimnis()).toBe('navi__api_key');
  });

  it('benutzt `!secret` weiterhin fürs WLAN — dort legt der Betreiber es selbst an', () => {
    // Die Gegenprobe: `!secret` ist nicht grundsätzlich falsch. Für WLAN ist
    // es richtig, denn diese beiden Einträge legt jeder ESPHome-Betreiber
    // ohnehin an, und sie gehören erst recht nicht ins Repository.
    expect(ohneKommentare()).toContain('!secret wifi_ssid');
    expect(ohneKommentare()).toContain('!secret wifi_password');
  });
});
