/**
 * Tests fuer `services/tiles/build-pmtiles.sh`.
 *
 * WAS HIER BEWIESEN WIRD UND WAS NICHT: planetiler selbst laeuft hier nie —
 * diese Umgebung hat keinen Docker-Daemon und keinen Netzzugriff auf
 * ghcr.io. Stattdessen wird `docker` durch ein STUB-Programm im PATH
 * ersetzt, das sich genau so verhaelt, wie der echte Aufruf sich verhalten
 * wuerde (schreibt eine Datei mit PMTiles-Signatur / schreibt nichts /
 * schreibt Muell / faellt mit Exit != 0 um). Damit ist die gesamte Logik
 * DRUMHERUM echt durchgespielt: Argumentbehandlung, Ableitung der
 * Regions-ID, Zielpfad, Signaturpruefung, atomarer Swap und jeder
 * Fehlerpfad — inklusive der Zusicherung, dass eine bereits installierte
 * Karte bei einem Fehlschlag unangetastet bleibt (W-17).
 *
 * Als Vitest-Test (statt eines eigenen `.test.sh` wie bei
 * `services/photon/download-index.test.sh`), damit er im ohnehin
 * existierenden `npx vitest run` mitlaeuft und KEIN zusaetzlicher CI-Job
 * noetig wird.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'build-pmtiles.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

let work: string;
let tilesDir: string;
let stubBin: string;

/**
 * Writes a `docker` stub onto a private PATH directory. `body` is the shell
 * body it runs; it receives the real argv, so a stub can inspect the
 * planetiler arguments the script built.
 */
function installDockerStub(body: string): void {
  const path = join(stubBin, 'docker');
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, 'utf-8');
  chmodSync(path, 0o755);
}

/**
 * Writes a `java` stub. Im JAR-Modus ruft das Skript `java -Xmx... -jar
 * <jar> <args>` auf; der Stub schreibt seine argv nach `java-argv.txt` und
 * legt eine gueltige PMTiles-Datei an der `--output=`-Stelle ab -- diesmal
 * ein ECHTER Pfad, kein Container-Pfad, was der Test genau pruefen soll.
 */
function installJavaStub(): void {
  const path = join(stubBin, 'java');
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "\${STUB_LOG_JAVA}"
out=""
for arg in "$@"; do
  case "$arg" in
    --output=*) out="\${arg#--output=}";;
  esac
done
[ -n "$out" ] || { echo "java-stub: kein --output gefunden" >&2; exit 91; }
printf 'PMTiles' > "$out"
head -c 120 /dev/zero >> "$out"
`,
    'utf-8',
  );
  chmodSync(path, 0o755);
}

/** A stub that behaves like a successful planetiler run: it finds `-v
 *  <host>:/data` in its own argv and writes a valid PMTiles file to the
 *  `--output=` path inside that mount. */
const SUCCESSFUL_DOCKER_STUB = `
host_dir=""
out_rel=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-v" ]; then host_dir="\${arg%%:*}"; fi
  case "$arg" in
    --output=*) out_rel="\${arg#--output=}";;
  esac
  prev="$arg"
done
[ -n "$host_dir" ] || { echo "stub: kein -v mount gefunden" >&2; exit 90; }
[ -n "$out_rel" ] || { echo "stub: kein --output gefunden" >&2; exit 91; }
# /data/out.pmtiles -> <host_dir>/out.pmtiles
target="$host_dir/\${out_rel#/data/}"
printf 'PM' > "$target"
head -c 200 /dev/zero >> "$target"
# Argumente mitprotokollieren, damit der Test sie pruefen kann.
printf '%s\\n' "$@" > "\${STUB_LOG:?}"
`;

const BASH = existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash';

/**
 * A PATH directory holding ONLY the external commands the script itself
 * uses -- deliberately WITHOUT `docker`. Emptying PATH entirely would not
 * work (the script needs `mktemp`/`cp`/… and this host has a real
 * `/usr/bin/docker` that any normal PATH would find).
 */
function makeDockerlessBin(options: { withJava?: boolean } = {}): string {
  const dir = join(work, options.withJava ? 'nodocker-java-bin' : 'nodocker-bin');
  mkdirSync(dir, { recursive: true });
  // `bash` gehoert dazu, weil die Stubs selbst `#!/usr/bin/env bash` nutzen --
  // `env` sucht den Interpreter im PATH, nicht im PATH des Aufrufers.
  for (const tool of ['bash', 'dirname', 'basename', 'mktemp', 'rm', 'mkdir', 'cp', 'mv', 'head', 'wc', 'tr', 'cat', 'stat', 'sync']) {
    const resolved = execFileSync(BASH, ['-c', `command -v ${tool} || true`], { encoding: 'utf-8' }).trim();
    if (resolved) {
      symlinkSync(resolved, join(dir, tool));
    }
  }
  // Der Add-on-Container hat KEIN docker, aber SEHR WOHL eine JRE (das Image
  // installiert `default-jre-headless` für Photon). Genau diese Kombination
  // liess sich vorher nicht nachstellen -- und genau in ihr lag der Fehler.
  if (options.withJava) {
    installJavaStub();
    symlinkSync(join(stubBin, 'java'), join(dir, 'java'));
  }
  return dir;
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync(BASH, [SCRIPT, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        TILES_DIR: tilesDir,
        STUB_LOG: join(work, 'docker-argv.txt'),
        STUB_LOG_JAVA: join(work, 'java-argv.txt'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'pmtiles-build-test-'));
  tilesDir = join(work, 'tiles');
  stubBin = join(work, 'bin');
  mkdirSync(tilesDir, { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  installDockerStub(SUCCESSFUL_DOCKER_STUB);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A minimal stand-in for an OSM extract; the stub never parses it. */
function writeFakePbf(name = 'liechtenstein-latest.osm.pbf'): string {
  const path = join(work, name);
  writeFileSync(path, Buffer.alloc(1024, 7));
  return path;
}

describe('build-pmtiles.sh — Argumentbehandlung', () => {
  it('ohne Argumente: Usage auf stderr, Exit 1', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: services/tiles/build-pmtiles.sh');
  });

  it('mit drei Argumenten: Usage auf stderr, Exit 1', () => {
    const result = run(['a', 'b', 'c']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });

  it('fehlende lokale PBF: klare deutsche Fehlermeldung, Exit 1, nichts installiert', () => {
    const result = run([join(work, 'gibtsnicht.osm.pbf')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lokale PBF-Datei nicht gefunden');
    // Der Hinweis muss sagen, WAS erwartet wird -- nicht nur, dass etwas fehlt.
    expect(result.stderr).toContain('.osm.pbf');
    expect(existsSync(join(tilesDir, 'gibtsnicht.pmtiles'))).toBe(false);
  });

  it('ungueltige Regions-ID wird abgelehnt, bevor irgendetwas gebaut wird', () => {
    const pbf = writeFakePbf();
    const result = run([pbf, 'nicht/erlaubt']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ungueltige Regions-ID');
    expect(result.stderr).toContain('paths.ts');
  });
});

describe('build-pmtiles.sh — Ableitung der Regions-ID und des Zielpfads', () => {
  it('leitet "liechtenstein" aus "liechtenstein-latest.osm.pbf" ab', () => {
    const pbf = writeFakePbf('liechtenstein-latest.osm.pbf');
    const result = run([pbf]);
    expect(result.status).toBe(0);
    expect(existsSync(join(tilesDir, 'liechtenstein.pmtiles'))).toBe(true);
  });

  it('leitet "bayern" aus "bayern.osm.pbf" ab (ohne -latest-Suffix)', () => {
    const pbf = writeFakePbf('bayern.osm.pbf');
    const result = run([pbf]);
    expect(result.status).toBe(0);
    expect(existsSync(join(tilesDir, 'bayern.pmtiles'))).toBe(true);
  });

  it('eine explizit uebergebene Regions-ID gewinnt gegen den Dateinamen', () => {
    const pbf = writeFakePbf('irgendwas-latest.osm.pbf');
    const result = run([pbf, 'meine_region']);
    expect(result.status).toBe(0);
    expect(existsSync(join(tilesDir, 'meine_region.pmtiles'))).toBe(true);
    expect(existsSync(join(tilesDir, 'irgendwas.pmtiles'))).toBe(false);
  });

  it('legt TILES_DIR an, wenn es noch nicht existiert', () => {
    const fresh = join(work, 'noch-nicht-da');
    const pbf = writeFakePbf();
    const result = run([pbf], { TILES_DIR: fresh });
    expect(result.status).toBe(0);
    expect(existsSync(join(fresh, 'liechtenstein.pmtiles'))).toBe(true);
  });
});

describe('build-pmtiles.sh — planetiler-Aufruf', () => {
  it('uebergibt --osm-path/--output und den Xmx-Heap an den Container', () => {
    const pbf = writeFakePbf();
    const result = run([pbf], { PLANETILER_XMX: '3g' });
    expect(result.status).toBe(0);
    const argv = readFileSync(join(work, 'docker-argv.txt'), 'utf-8');
    expect(argv).toContain('--osm-path=/data/input.osm.pbf');
    expect(argv).toContain('--output=/data/out.pmtiles');
    expect(argv).toContain('-Xmx3g');
    // Auf eine VERSION gepinnt, nicht `:latest` -- gleiche Regel wie ueberall
    // sonst im Repo (pnpm 10.33.0, node 22). v0.10.2 ist die Version, deren
    // Release-Artefakt belegt existiert (vom Betreiber im Browser geprueft).
    expect(argv).toContain('ghcr.io/onthegomap/planetiler:v0.10.2');
    expect(argv).not.toContain(':latest');
  });

  /**
   * Der JAR-Modus ist nicht bloss Bequemlichkeit: INNERHALB eines
   * HA-Add-on-Containers gibt es keinen Docker-Socket, dort ist `java -jar`
   * der einzig moegliche Weg. Der Test belegt, dass dann WEDER `docker`
   * aufgerufen wird NOCH Container-Pfade (`/data/...`) durchrutschen.
   */
  it('PLANETILER_JAR laeuft ueber java statt docker und biegt die Pfade um', () => {
    const pbf = writeFakePbf();
    const jar = join(work, 'planetiler.jar');
    writeFileSync(jar, 'nicht wirklich ein jar');
    installJavaStub();
    const result = run([pbf], { PLANETILER_JAR: jar });
    expect(result.status).toBe(0);
    // docker darf gar nicht erst angefasst worden sein
    expect(existsSync(join(work, 'docker-argv.txt'))).toBe(false);
    const argv = readFileSync(join(work, 'java-argv.txt'), 'utf-8');
    expect(argv).toContain('-jar');
    expect(argv).toContain(jar);
    // Pfade zeigen auf das echte Arbeitsverzeichnis, nicht auf /data
    expect(argv).not.toContain('/data/');
  });

  it('PLANETILER_JAR ohne vorhandene Datei bricht mit klarer Meldung ab', () => {
    const pbf = writeFakePbf();
    const result = run([pbf], { PLANETILER_JAR: join(work, 'fehlt.jar') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/existiert nicht/);
    expect(result.stderr).toContain('planetiler/releases/download/v0.10.2');
  });

  it('PLANETILER_IMAGE und PLANETILER_ARGS ueberschreiben Image und Argumente', () => {
    const pbf = writeFakePbf();
    const result = run([pbf], {
      PLANETILER_IMAGE: 'example.invalid/planetiler:pinned',
      PLANETILER_ARGS: '--input=%INPUT% --output=%OUTPUT% --eigenes-flag',
    });
    expect(result.status).toBe(0);
    const argv = readFileSync(join(work, 'docker-argv.txt'), 'utf-8');
    expect(argv).toContain('example.invalid/planetiler:pinned');
    expect(argv).toContain('--input=/data/input.osm.pbf');
    expect(argv).toContain('--output=/data/out.pmtiles');
    expect(argv).toContain('--eigenes-flag');
    // Die Default-Argumente duerfen dann NICHT zusaetzlich mitlaufen.
    expect(argv).not.toContain('--nodemap-type=sortedtable');
  });

  it('ohne docker im PATH: Fehlermeldung nennt beide Alternativen', () => {
    const pbf = writeFakePbf();
    // `docker` wird durch ein Stub ersetzt, das so tut, als gaebe es das
    // Kommando nicht -- ein leerer PATH ginge nicht, weil das Skript selbst
    // `basename`/`mktemp`/`cp` braucht (und auf diesem Host ein echtes
    // /usr/bin/docker liegt, das sonst gefunden wuerde).
    const result = run([pbf], { PATH: makeDockerlessBin() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docker nicht im PATH');
    expect(result.stderr).toContain('JAR');
    expect(result.stderr).toContain('kopieren');
  });

  /**
   * DER FALL DES ADD-ONS -- und der, der hier gefehlt hat.
   *
   * Im HA-Add-on-Container gibt es kein docker, aber eine JRE, und der
   * Wrapper setzt PLANETILER_JAR. Genau diese Kombination kam in keinem
   * Test vor: der JAR-Test oben laeuft mit docker-Stub im PATH, der
   * Dockerless-Test oben ohne PLANETILER_JAR. In der Luecke dazwischen
   * stand eine ungeschuetzte `command -v docker`-Pruefung VOR der
   * Auswertung von PLANETILER_JAR -- der JAR-Modus war also unerreichbar,
   * und der Knopf „Kacheln bauen" brach mit dem Rat ab, die Kacheln „auf
   * einem anderen Rechner" zu bauen.
   */
  it('ohne docker, aber mit PLANETILER_JAR und java: baut trotzdem (Add-on-Fall)', () => {
    const pbf = writeFakePbf();
    const jar = join(work, 'planetiler.jar');
    writeFileSync(jar, 'nicht wirklich ein jar');
    const result = run([pbf], {
      PATH: makeDockerlessBin({ withJava: true }),
      PLANETILER_JAR: jar,
    });
    expect(result.stderr).not.toContain('docker nicht im PATH');
    expect(result.status).toBe(0);
    expect(existsSync(join(work, 'docker-argv.txt'))).toBe(false);
    const argv = readFileSync(join(work, 'java-argv.txt'), 'utf-8');
    expect(argv).toContain('-jar');
    expect(argv).toContain(jar);
  });
});

describe('build-pmtiles.sh — Pruefung des Erzeugnisses', () => {
  it('planetiler-Fehlschlag: Exit 1, verwertbarer Hinweis, nichts installiert', () => {
    installDockerStub('echo "planetiler: OutOfMemoryError" >&2; exit 137');
    const pbf = writeFakePbf();
    const result = run([pbf]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('planetiler-Lauf fehlgeschlagen');
    expect(result.stderr).toContain('PLANETILER_XMX');
    expect(existsSync(join(tilesDir, 'liechtenstein.pmtiles'))).toBe(false);
  });

  it('planetiler meldet Erfolg, erzeugt aber nichts: Exit 1 mit passendem Hinweis', () => {
    installDockerStub('exit 0');
    const pbf = writeFakePbf();
    const result = run([pbf]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('wurde nicht erzeugt');
    expect(existsSync(join(tilesDir, 'liechtenstein.pmtiles'))).toBe(false);
  });

  it('erzeugte Datei ohne PMTiles-Signatur wird NICHT eingetauscht', () => {
    installDockerStub(`
host_dir=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-v" ]; then host_dir="\${arg%%:*}"; fi
  prev="$arg"
done
printf '<html>404 Not Found</html>' > "$host_dir/out.pmtiles"
`);
    const pbf = writeFakePbf();
    const result = run([pbf]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('keine PMTiles-Datei');
    expect(result.stderr).toContain('NICHTS eingetauscht');
    expect(existsSync(join(tilesDir, 'liechtenstein.pmtiles'))).toBe(false);
  });

  it('leere Ausgabedatei wird abgelehnt', () => {
    installDockerStub(`
host_dir=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-v" ]; then host_dir="\${arg%%:*}"; fi
  prev="$arg"
done
: > "$host_dir/out.pmtiles"
`);
    const pbf = writeFakePbf();
    const result = run([pbf]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('leer');
  });
});

describe('build-pmtiles.sh — atomarer Swap (W-17)', () => {
  it('ersetzt eine vorhandene Karte erst nach erfolgreichem Build', () => {
    const target = join(tilesDir, 'liechtenstein.pmtiles');
    writeFileSync(target, Buffer.concat([Buffer.from('PM'), Buffer.alloc(50, 1)]));
    const before = readFileSync(target);

    const pbf = writeFakePbf();
    const result = run([pbf]);

    expect(result.status).toBe(0);
    const after = readFileSync(target);
    expect(after.equals(before)).toBe(false);
    expect(after.subarray(0, 2).toString()).toBe('PM');
  });

  it('laesst eine vorhandene Karte bei einem Build-Fehler unveraendert', () => {
    const target = join(tilesDir, 'liechtenstein.pmtiles');
    const original = Buffer.concat([Buffer.from('PM'), Buffer.alloc(50, 1)]);
    writeFileSync(target, original);

    installDockerStub('echo "boom" >&2; exit 1');
    const pbf = writeFakePbf();
    const result = run([pbf]);

    expect(result.status).toBe(1);
    expect(readFileSync(target).equals(original)).toBe(true);
  });

  it('hinterlaesst keine .new-Staging-Datei nach einem erfolgreichen Lauf', () => {
    const pbf = writeFakePbf();
    expect(run([pbf]).status).toBe(0);
    expect(existsSync(join(tilesDir, '.liechtenstein.pmtiles.new'))).toBe(false);
  });

  it('meldet am Ende den Zielpfad und dass kein Neustart noetig ist', () => {
    const pbf = writeFakePbf();
    const result = run([pbf]);
    expect(result.stdout).toContain('liechtenstein.pmtiles');
    expect(result.stdout).toContain('kein Neustart noetig');
  });
});
