/**
 * Passt der Bildpuffer überhaupt in den Arbeitsspeicher?
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * Nach dem Flashen stand im Protokoll des Geräts:
 *
 *   [E][display:016]: Could not allocate buffer for display!
 *   [E][component:204]: display was marked as failed
 *
 * Alles andere lief weiter — WLAN, API, der Rest des Programms. Nur der
 * Bildschirm blieb schwarz. Ein Fehler, der sich nicht durch Übersetzen
 * finden lässt: der Quelltext ist einwandfrei, er passt nur nicht ins Gerät.
 *
 * ─── WAS DIESE PRÜFUNG KANN UND WAS NICHT ───────────────────────────────────
 * Sie misst KEINEN Arbeitsspeicher. Das ginge nur auf dem Gerät. Sie rechnet
 * die Puffergröße aus der Konfiguration aus und vergleicht sie mit einer
 * Obergrenze, die hier ausdrücklich begründet steht.
 *
 * Das ist schwächer als eine Messung — aber es hätte genau diesen Fall
 * gefangen, und darum geht es. Die Zahl ist eine Entscheidung, keine
 * Naturkonstante; deshalb steht sie benannt da und nicht versteckt in einem
 * Vergleich.
 *
 * ─── DIE RECHNUNG, NACHGELESEN STATT GESCHÄTZT ──────────────────────────────
 * `ili9xxx_display.h`:
 *     ILI9XXXColorMode buffer_color_mode_{BITS_16};        // Voreinstellung
 * `ili9xxx_display.cpp`, `alloc_buffer_()`:
 *     if (buffer_color_mode_ == BITS_16)
 *       init_internal_(get_buffer_length_() * 2);
 *     else
 *       init_internal_(get_buffer_length_());
 * `display.py`:
 *     elif config[CONF_COLOR_PALETTE] == "8BIT":
 *         cg.add(var.set_buffer_color_mode(ILI9XXXColorMode.BITS_8))
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const YAML = join(HIER, '..', 'yapaja-nav-display.yaml');

/**
 * Was ein ESP32-C3 OHNE PSRAM realistisch am Stück hergibt, nachdem WLAN,
 * TCP/IP und die verschlüsselte API ihren Teil genommen haben.
 *
 * Der C3 auf diesem Board hat 400 kB SRAM. Davon ist nach dem Start des Funks
 * weniger frei, und das Freie ist zerstückelt — ein Puffer braucht aber EINEN
 * zusammenhängenden Block. 64 kB ist die Grenze, unterhalb derer die
 * Zuteilung in der Praxis durchgeht; 115 kB (die Voreinstellung mit 16 Bit)
 * ist genau daran gescheitert.
 *
 * Diese Zahl ist NICHT gemessen. Sie ist bewusst konservativ gewählt und
 * steht hier als das, was sie ist: eine Annahme mit einer Begründung. Wer es
 * besser weiß, ändert sie hier — an EINER Stelle.
 */
const C3_PUFFER_GRENZE_BYTES = 64 * 1024;

function konfiguration(): string {
  return readFileSync(YAML, 'utf-8');
}

/** Die Maße aus dem `dimensions:`-Block. */
function masse(text: string): { breite: number; hoehe: number } {
  const breite = text.match(/^\s*width:\s*(\d+)\s*$/m);
  const hoehe = text.match(/^\s*height:\s*(\d+)\s*$/m);
  if (!breite || !hoehe) throw new Error('Keine dimensions: in der Konfiguration gefunden');
  return { breite: Number(breite[1]), hoehe: Number(hoehe[1]) };
}

/** Bytes je Bildpunkt — 2 ohne Angabe, 1 mit `8BIT`. */
function bytesJeBildpunkt(text: string): number {
  const palette = text.match(/^\s*color_palette:\s*(\S+)\s*$/m);
  if (!palette) return 2; // ESPHome-Voreinstellung: BITS_16
  return palette[1].toUpperCase() === '8BIT' ? 1 : 2;
}

export function pufferBytes(text: string): number {
  const { breite, hoehe } = masse(text);
  return breite * hoehe * bytesJeBildpunkt(text);
}

describe('Der Bildpuffer muss auf den ESP32-C3 passen', () => {
  it('bleibt unter der Grenze, die ein C3 am Stück hergibt', () => {
    const bytes = pufferBytes(konfiguration());
    expect(
      bytes,
      `Der Bildpuffer wäre ${bytes} Byte. Auf dem Gerät ergibt das ` +
        '"Could not allocate buffer for display!", und der Bildschirm bleibt ' +
        'schwarz, während alles andere weiterläuft.',
    ).toBeLessThanOrEqual(C3_PUFFER_GRENZE_BYTES);
  });

  it('die Rechnung stimmt mit ESPHomes eigener überein', () => {
    // 240 x 240 x 1 Byte bei `8BIT`. Stünde hier etwas anderes, wäre die
    // Prüfung oben wertlos — sie vergliche dann eine erfundene Zahl.
    expect(pufferBytes(konfiguration())).toBe(240 * 240);
  });

  it('OHNE `color_palette` wären es doppelt so viele — und zu viele', () => {
    // Der Zustand, in dem das Gerät gescheitert ist. Als Gegenprobe, damit
    // die Prüfung oben nicht bloß zufällig besteht.
    const ohne = konfiguration().replace(/^\s*color_palette:.*$/m, '');
    expect(pufferBytes(ohne)).toBe(240 * 240 * 2);
    expect(pufferBytes(ohne)).toBeGreaterThan(C3_PUFFER_GRENZE_BYTES);
  });

  it('das Board hat kein PSRAM — sonst wäre die Grenze eine andere', () => {
    // Mit PSRAM dürfte der Puffer deutlich größer sein. Taucht hier einmal
    // ein `psram:` auf, ist die Grenze oben zu streng und gehört überdacht.
    expect(konfiguration()).not.toMatch(/^psram:/m);
  });
});
