#!/usr/bin/env node
/**
 * generate-licenses.mjs — Lizenz-Inventar + Copyleft-Gate (E10-T4, docs/07 §7,
 * docs/00 "Rechtliches").
 *
 * ─── Datenquelle: warum NICHT `license-checker` ──────────────────────────────
 *
 * Die Aufgabe nennt `license-checker`. Beide Varianten wurden hier ausprobiert
 * und beide taugen fuer dieses Repository nicht:
 *
 *   • `license-checker@25.0.1` (das Original) stuerzt unter Node 22 beim Start
 *     ab (`read-installed` -> SyntaxError). Es ist seit Jahren unmaintained.
 *   • `license-checker-rseidelsohn@5` (der gepflegte Fork) laeuft zwar, findet
 *     in `apps/core` aber nur **13** Pakete: er erwartet den verschachtelten
 *     npm-`node_modules`-Baum, waehrend pnpm einen flachen Store mit Symlinks
 *     anlegt. Die transitiven Abhaengigkeiten fehlen also schlicht.
 *
 * Ein Inventar, das den Grossteil der Abhaengigkeiten nicht sieht, ist fuer ein
 * Copyleft-Gate wertlos — es wuerde zuverlaessig gruen melden. Datenquelle ist
 * darum `pnpm licenses list`, der native Befehl des hier eingesetzten Paket-
 * managers: er liest denselben Store, aus dem auch installiert wird, und findet
 * **189** Produktionspakete statt 13. Selber Zweck, korrekte Zahlen.
 *
 * ─── Was "ausgeliefert" heisst ───────────────────────────────────────────────
 *
 * Blockierend ist nur, was das Geraet erreicht:
 *   • `apps/core`-Produktionsabhaengigkeiten -> per `pnpm install --prod` ins
 *     Docker-Image (apps/core/Dockerfile),
 *   • `apps/web`-Produktionsabhaengigkeiten -> in das JS-Bundle hineinkompiliert.
 * Dev-Werkzeuge (vitest, vite, eslint, playwright …) werden nie ausgeliefert und
 * sind damit fuer die Copyleft-Frage irrelevant; sie werden separat gezaehlt.
 *
 * ─── Das Gate ───────────────────────────────────────────────────────────────
 *
 * Starkes Copyleft (GPL/AGPL/SSPL/OSL/EUPL/CPAL) im ausgelieferten Satz laesst
 * den Job fehlschlagen (Akzeptanzkriterium 3). Schwaches Copyleft (LGPL, MPL,
 * EPL, CDDL) ist nicht automatisch ein Fehler, muss aber namentlich in
 * `REVIEWED_WEAK_COPYLEFT` stehen — es faellt also auf, statt durchzurutschen.
 *
 * Verwendung:
 *   node scripts/generate-licenses.mjs           # docs/licenses.md schreiben
 *   node scripts/generate-licenses.mjs --check   # CI: aktuell? + Copyleft-Gate
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const OUTPUT_PATH = join(REPO_ROOT, 'docs', 'licenses.md');

/**
 * Starkes Copyleft: die Lizenz greift auf das Gesamtwerk durch. Ein solcher
 * Treffer im ausgelieferten Bundle ist ein Fehlschlag, kein Hinweis.
 */
export const STRONG_COPYLEFT = [
  'GPL-1.0', 'GPL-2.0', 'GPL-3.0', 'AGPL-1.0', 'AGPL-3.0',
  'SSPL-1.0', 'OSL-1.0', 'OSL-2.0', 'OSL-2.1', 'OSL-3.0',
  'EUPL-1.0', 'EUPL-1.1', 'EUPL-1.2', 'CPAL-1.0', 'RPL-1.5', 'QPL-1.0',
];

/**
 * Schwaches (datei-/bibliotheksbezogenes) Copyleft. Bei unveraenderter
 * Weitergabe meist unproblematisch, aber nie stillschweigend: jede hier
 * auftauchende Lizenz muss unten explizit quittiert werden.
 */
export const WEAK_COPYLEFT = [
  'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-1.1', 'MPL-2.0',
  'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1', 'CECILL-C',
];

/**
 * Namentlich geprueftes schwaches Copyleft im ausgelieferten Satz.
 * LEER — im aktuellen Stand enthaelt das Bundle ueberhaupt kein Copyleft.
 * Ein neuer Eintrag hier ist eine bewusste juristische Entscheidung und
 * gehoert in den PR-Text, nicht in eine stille Zeile.
 * @type {Record<string, string>}
 */
export const REVIEWED_WEAK_COPYLEFT = {};

/**
 * Zerlegt einen SPDX-Ausdruck in die einzelnen Lizenz-Bezeichner.
 * `(MIT OR Apache-2.0)` -> ['MIT', 'Apache-2.0'].
 */
export function splitSpdx(expression) {
  return String(expression ?? '')
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toUpperCase() !== 'OR' && part.toUpperCase() !== 'AND');
}

/** Normalisiert `GPL-3.0-or-later`/`GPL-3.0+` auf den Basis-Bezeichner. */
export function baseLicenseId(id) {
  return String(id).replace(/-(?:only|or-later)$/i, '').replace(/\+$/, '');
}

/**
 * Klassifiziert einen SPDX-Ausdruck.
 *
 * Wichtig fuer Doppel-Lizenzen: `(MIT OR GPL-2.0)` ist NICHT copyleft — wir
 * duerfen die permissive Seite waehlen. Erst wenn ALLE Alternativen copyleft
 * sind, ist das Paket copyleft. `AND` dagegen bindet kumulativ; um das nicht
 * falsch-negativ zu behandeln, wird ein Ausdruck mit `AND` konservativ
 * behandelt (jeder Copyleft-Teil zaehlt).
 *
 * @returns {'strong-copyleft'|'weak-copyleft'|'permissive'|'unknown'}
 */
export function classifyLicense(expression) {
  const raw = String(expression ?? '').trim();
  if (raw.length === 0 || /^(unknown|unlicensed|see license)/i.test(raw)) return 'unknown';

  const parts = splitSpdx(raw).map(baseLicenseId);
  if (parts.length === 0) return 'unknown';

  const strongFlags = parts.map((p) => STRONG_COPYLEFT.includes(p));
  const weakFlags = parts.map((p) => WEAK_COPYLEFT.includes(p));
  const hasAnd = /\sAND\s/i.test(raw);
  const isDisjunction = /\sOR\s/i.test(raw) && !hasAnd;

  if (isDisjunction) {
    // Nur wenn JEDE Alternative copyleft ist, bleibt uns keine Wahl.
    if (strongFlags.every(Boolean)) return 'strong-copyleft';
    if (parts.every((p, i) => strongFlags[i] || weakFlags[i])) return 'weak-copyleft';
    return 'permissive';
  }
  if (strongFlags.some(Boolean)) return 'strong-copyleft';
  if (weakFlags.some(Boolean)) return 'weak-copyleft';
  return 'permissive';
}

/**
 * Flacht die Ausgabe von `pnpm licenses list --json` (Gruppierung nach Lizenz)
 * zu einer Paketliste ab.
 * @returns {Array<{name: string, version: string, license: string, homepage: string}>}
 */
export function flattenPnpmLicenses(report) {
  const out = [];
  if (!report || typeof report !== 'object') return out;
  for (const [license, entries] of Object.entries(report)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const versions = Array.isArray(entry.versions) && entry.versions.length > 0
        ? entry.versions
        : [entry.version ?? '?'];
      for (const version of versions) {
        out.push({
          name: entry.name ?? 'unbekannt',
          version,
          license: entry.license ?? license,
          homepage: entry.homepage ?? '',
        });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Findet alles, was das Gate rot machen muss.
 * @returns {{strong: object[], unreviewedWeak: object[], unknown: object[]}}
 */
export function findCopyleftViolations(packages) {
  const strong = [];
  const unreviewedWeak = [];
  const unknown = [];
  for (const pkg of packages) {
    const verdict = classifyLicense(pkg.license);
    if (verdict === 'strong-copyleft') strong.push(pkg);
    else if (verdict === 'weak-copyleft' && !REVIEWED_WEAK_COPYLEFT[pkg.name]) unreviewedWeak.push(pkg);
    else if (verdict === 'unknown') unknown.push(pkg);
  }
  return { strong, unreviewedWeak, unknown };
}

export function groupByLicense(packages) {
  const groups = new Map();
  for (const pkg of packages) {
    const list = groups.get(pkg.license) ?? [];
    list.push(pkg);
    groups.set(pkg.license, list);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

// ─── Dokument ────────────────────────────────────────────────────────────────

function runPnpm(args) {
  return execFileSync('pnpm', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Baut `docs/licenses.md`. Bewusst deterministisch (keine Zeitstempel, keine
 * Pfade aus dem Store) — sonst koennte der `--check`-Lauf in CI nie gruen sein.
 */
export function renderDocument({ prodPackages, devOnlyCount, violations }) {
  const groups = groupByLicense(prodPackages);
  const lines = [];
  const p = (line = '') => lines.push(line);

  p('# Lizenz-Inventar & Attribution');
  p();
  p('> **Generiert.** Diese Datei wird von `scripts/generate-licenses.mjs` erzeugt.');
  p('> Nicht von Hand bearbeiten — Aenderungen gehen beim naechsten Lauf verloren.');
  p('> Neu erzeugen: `pnpm licenses:generate`. CI prueft mit `pnpm licenses:check`,');
  p('> dass diese Datei zum aktuellen Abhaengigkeitsstand passt (Job `dependency-audit`).');
  p();
  p('Erfuellt E10-T4 (Lizenz-Inventar) und den Release-Gate-Punkt');
  p('„Lizenz-/Attributions-Pruefung (OSM, Fonts, Icons, Dependencies)" aus docs/07 §7.');
  p();
  p('---');
  p();

  p('## 1. Kartendaten — OpenStreetMap / ODbL');
  p();
  p('Yapaja Go erhebt keine eigenen Kartendaten; alle Geometrien, Restriktionen und');
  p('POIs stammen aus OpenStreetMap (docs/00 „Rechtliches"). OSM-Daten stehen unter der');
  p('**Open Database License (ODbL) 1.0**, die eine sichtbare Namensnennung verlangt.');
  p();
  p('**Umsetzung:** die Attribution `© OpenStreetMap contributors` liegt dauerhaft und');
  p('sichtbar auf der Karte (`apps/web/src/map/MapView.tsx`, `customAttribution`), zusaetzlich');
  p('im Erstnutzungs-Dialog (`apps/web/src/onboarding/steps/DisclaimerStep.tsx`).');
  p();
  p('**Automatisch verifiziert** — die Attribution ist nicht nur vorhanden, ihr Fehlen');
  p('laesst die Pipeline fehlschlagen. Die bestehenden E2E-Assertions:');
  p();
  p('| Assertion | Datei | Kontext |');
  p('|---|---|---|');
  p('| `getByText(\'OpenStreetMap contributors\')` sichtbar | [`apps/web/e2e/map-render.spec.ts`](../apps/web/e2e/map-render.spec.ts) | Karten-Grundlast (ADR-003 / ODbL-Pflicht) |');
  p('| dito, im Offline-Kaltstart | [`apps/web/e2e/flow-01-cold-start-offline.spec.ts`](../apps/web/e2e/flow-01-cold-start-offline.spec.ts) | Pflicht-Flow 1 — Attribution auch ohne Netz |');
  p('| dito, unter HA-Ingress-Subpfad | [`apps/web/e2e/subpath.spec.ts`](../apps/web/e2e/subpath.spec.ts) | Pflicht-Flow 9 — Attribution ueberlebt den Reverse-Proxy |');
  p('| Disclaimer nennt OpenStreetMap | [`apps/web/e2e/profiles.spec.ts`](../apps/web/e2e/profiles.spec.ts) | Pflicht-Hinweis beim Profilrouting |');
  p();
  p('Die Routing- und Suchdaten (Valhalla-Graph, Photon-/Lite-Index) werden aus denselben');
  p('OSM-Extrakten abgeleitet und sind damit ebenfalls ODbL-abgeleitete Datenbanken;');
  p('der Prozess dafuer steht in [`docs/data-update-runbook.md`](data-update-runbook.md).');
  p();

  p('## 2. Schriften & Icons');
  p();
  p('| Gegenstand | Herkunft | Lizenz | Beleg |');
  p('|---|---|---|---|');
  p('| Schriftarten | **keine mitgeliefert** | — | Kein `@font-face`, keine `.woff/.ttf/.otf` im Repo; das gebaute CSS nutzt ausschliesslich `font-family: sans-serif` (Systemschrift). Damit entsteht keine Font-Lizenzpflicht. |');
  p('| App-/PWA-Icons (`apps/web/public/icons/*.png`) | Projekteigen, erstellt in E07-T5 | Projektlizenz (s. §6) | Keine Icon-Bibliothek als Abhaengigkeit; die PNGs tragen keine fremden Metadaten. |');
  p('| Manoever-Pfeile | Projekteigen, Inline-SVG | Projektlizenz (s. §6) | `apps/web/src/drive/arrows.tsx` — im Quelltext gezeichnet, kein Icon-Set. |');
  p('| Karten-Symbole/Labels | Aus dem Kartenstil, OSM-abgeleitet | ODbL (s. §1) | `apps/core/src/map/styles/` — kein externer Sprite-/Glyph-Server (offline-Betrieb). |');
  p();
  p('Gegenprobe fuer kuenftige Aenderungen: `find apps packages -name "*.woff*" -o -name "*.ttf"`');
  p('muss leer bleiben, und es darf kein Icon-Paket (lucide, heroicons, font-awesome …) in einer');
  p('`package.json` auftauchen.');
  p();

  p('## 3. Mitgelieferte Dienste (eigene Container)');
  p();
  p('Diese Dienste laufen als eigene Container neben dem Core; sie werden nicht in unser');
  p('Bundle gelinkt, sondern unveraendert als Image bezogen (`docker-compose.yml`).');
  p();
  p('| Dienst | Image | Lizenz des Projekts |');
  p('|---|---|---|');
  p('| Valhalla (Routing) | `ghcr.io/gis-ops/docker-valhalla/valhalla` | MIT |');
  p('| Photon (Geocoding) | `rtuszik/photon-docker` | Apache-2.0 |');
  p('| gpsd (GPS-Daemon) | Distributionspaket im Add-on-Image | BSD-2-Clause |');
  p('| Mosquitto (nur Test/HA-seitig) | `eclipse-mosquitto` | EPL-2.0 / EDL-1.0 |');
  p();
  p('Mosquitto ist der einzige Copyleft-Beruehrungspunkt (EPL-2.0, schwaches Copyleft) und');
  p('**gehoert nicht zum ausgelieferten Bundle**: der Broker wird von Home Assistant bzw. vom');
  p('Betreiber gestellt, wir sprechen ihn nur ueber MQTT an (Netzwerkprotokoll, kein Linken).');
  p();

  p('## 4. NPM-Abhaengigkeiten im ausgelieferten Produkt');
  p();
  p(`Erfasst: **${prodPackages.length}** Pakete (Produktionsabhaengigkeiten von`);
  p('`apps/core` — via `pnpm install --prod` im Image — und `apps/web` — in das JS-Bundle');
  p('kompiliert), inklusive aller transitiven Abhaengigkeiten.');
  p();
  p('| Lizenz | Pakete | Einstufung |');
  p('|---|---|---|');
  for (const [license, pkgs] of groups) {
    const verdict = classifyLicense(license);
    const label = {
      permissive: 'permissiv',
      'weak-copyleft': 'schwaches Copyleft',
      'strong-copyleft': '**starkes Copyleft**',
      unknown: '**unbekannt**',
    }[verdict];
    p(`| \`${license}\` | ${pkgs.length} | ${label} |`);
  }
  p();
  p('<details><summary>Vollstaendige Paketliste</summary>');
  p();
  p('| Paket | Version | Lizenz |');
  p('|---|---|---|');
  for (const pkg of prodPackages) {
    p(`| \`${pkg.name}\` | ${pkg.version} | \`${pkg.license}\` |`);
  }
  p();
  p('</details>');
  p();

  p('## 5. Copyleft-Pruefung (Akzeptanzkriterium 3)');
  p();
  if (violations.strong.length === 0 && violations.unreviewedWeak.length === 0) {
    p('**Ergebnis: keine Copyleft-Konflikte.**');
    p();
    p('Kein einziges Paket im ausgelieferten Satz steht unter GPL, AGPL, LGPL, SSPL, MPL,');
    p('EPL, CDDL, OSL, EUPL oder CPAL. Alle Lizenzen sind permissiv (MIT, ISC, BSD, Apache-2.0,');
    p('BlueOak-1.0.0, 0BSD) oder permissiv waehlbare Doppel-Lizenzen.');
  } else {
    p('**Ergebnis: Konflikt — dieses Gate ist rot.**');
    for (const pkg of violations.strong) {
      p(`- STARKES COPYLEFT: \`${pkg.name}@${pkg.version}\` (\`${pkg.license}\`)`);
    }
    for (const pkg of violations.unreviewedWeak) {
      p(`- UNGEPRUEFTES SCHWACHES COPYLEFT: \`${pkg.name}@${pkg.version}\` (\`${pkg.license}\`)`);
    }
  }
  p();
  if (violations.unknown.length > 0) {
    p('Pakete ohne maschinell erkennbare Lizenzangabe (manuell zu klaeren, blockieren nicht):');
    for (const pkg of violations.unknown) {
      p(`- \`${pkg.name}@${pkg.version}\`: \`${pkg.license}\``);
    }
    p();
  }
  p('Erzwungen wird das von `scripts/generate-licenses.mjs --check` im CI-Job');
  p('`dependency-audit`: eine GPL-Abhaengigkeit im ausgelieferten Bundle laesst die');
  p('Pipeline fehlschlagen, nicht bloss diese Datei anders aussehen.');
  p();
  p(`**Dev-Abhaengigkeiten** (${devOnlyCount} Pakete: vitest, vite, eslint, playwright, tsup …)`);
  p('sind hier bewusst nicht bewertet. Sie werden nie ausgeliefert — das Docker-Image');
  p('installiert mit `--prod` —, koennen das Produkt also nicht lizenzrechtlich binden.');
  p('Fuer Sicherheits-Advisories gilt dieselbe Trennung, dort aber mit sichtbarer Meldung:');
  p('siehe `scripts/dependency-audit.mjs` und `security/audit-exceptions.json`.');
  p();

  p('## 6. Offener Punkt: Lizenz des Projekts selbst');
  p();
  p('Das Repository hat derzeit **keine** `LICENSE`-Datei und in keiner `package.json` ein');
  p('`license`-Feld. Fuer die Abhaengigkeits- und Attributionspflichten oben ist das ohne');
  p('Belang, fuer die Veroeffentlichung von v1.0 aber eine menschliche Entscheidung, die vor');
  p('dem Release zu treffen ist (E10-T6, Release-Gate). Dieses Skript trifft sie nicht und');
  p('blockiert deswegen auch nicht.');
  p();
  return `${lines.join('\n')}\n`;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function collect() {
  const prodReport = JSON.parse(runPnpm(['licenses', 'list', '--prod', '--json']));
  const allReport = JSON.parse(runPnpm(['licenses', 'list', '--json']));
  const prodPackages = flattenPnpmLicenses(prodReport);
  const allPackages = flattenPnpmLicenses(allReport);
  const prodKeys = new Set(prodPackages.map((p) => `${p.name}@${p.version}`));
  const devOnlyCount = allPackages.filter((p) => !prodKeys.has(`${p.name}@${p.version}`)).length;
  const violations = findCopyleftViolations(prodPackages);
  return { prodPackages, devOnlyCount, violations };
}

function main(argv) {
  const check = argv.includes('--check');
  const data = collect();
  const document = renderDocument(data);
  const { strong, unreviewedWeak } = data.violations;

  if (!check) {
    writeFileSync(OUTPUT_PATH, document);
    process.stdout.write(`docs/licenses.md geschrieben (${data.prodPackages.length} Pakete).\n`);
  }

  let failed = false;

  if (check) {
    if (!existsSync(OUTPUT_PATH)) {
      process.stdout.write('FEHLER: docs/licenses.md fehlt. `pnpm licenses:generate` ausfuehren.\n');
      failed = true;
    } else if (readFileSync(OUTPUT_PATH, 'utf8') !== document) {
      process.stdout.write(
        'FEHLER: docs/licenses.md ist nicht mehr aktuell — die Abhaengigkeiten haben sich\n' +
          'geaendert, ohne dass das Inventar neu erzeugt wurde.\n' +
          'Behebung: `pnpm licenses:generate` ausfuehren und das Ergebnis mit committen.\n',
      );
      failed = true;
    } else {
      process.stdout.write(`docs/licenses.md ist aktuell (${data.prodPackages.length} Pakete).\n`);
    }
  }

  process.stdout.write('\n=== Copyleft-Gate (ausgelieferte Abhaengigkeiten) ===\n');
  if (strong.length === 0 && unreviewedWeak.length === 0) {
    process.stdout.write(`  ${data.prodPackages.length} Pakete geprueft, kein Copyleft. ✓\n`);
  } else {
    for (const pkg of strong) {
      process.stdout.write(`  STARKES COPYLEFT: ${pkg.name}@${pkg.version} (${pkg.license})\n`);
    }
    for (const pkg of unreviewedWeak) {
      process.stdout.write(
        `  UNGEPRUEFTES SCHWACHES COPYLEFT: ${pkg.name}@${pkg.version} (${pkg.license})\n`,
      );
    }
    failed = true;
  }
  if (data.violations.unknown.length > 0) {
    process.stdout.write(
      `  Hinweis: ${data.violations.unknown.length} Paket(e) ohne erkennbare Lizenzangabe ` +
        '(nicht blockierend, im Dokument gelistet).\n',
    );
  }

  process.stdout.write(failed ? '\nLIZENZ-GATE ROT.\n' : '\nLIZENZ-GATE GRUEN.\n');
  return failed ? 1 : 0;
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`generate-licenses: ${err?.message ?? String(err)}\n`);
    process.exit(2);
  }
}
