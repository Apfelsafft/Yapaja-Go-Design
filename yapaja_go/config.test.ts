/**
 * In-repo, fully deterministic structural check for `config.yaml` (E08-T4).
 *
 * This is the PER-PR merge-gate counterpart to `frenck/action-addon-linter`
 * (which runs nightly, `continue-on-error`, see `yapaja_go/PACKAGING.md` "CI
 * strategy" for the full rationale). It does not attempt to reproduce the
 * Supervisor's entire config schema -- only the specific, load-bearing keys
 * `tasks/E08-home-assistant.md` and `docs/04-home-assistant.md` §3 call out
 * explicitly, so a typo/regression in any of them fails fast, in-repo, with
 * no network dependency and no third-party Action that could itself be
 * flaky or unavailable.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { load } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDON_DIR = __dirname;
const CONFIG_PATH = join(ADDON_DIR, 'config.yaml');

/** Supervisor's default when `ingress_port` is omitted from config.yaml. */
const SUPERVISOR_DEFAULT_INGRESS_PORT = 8099;

interface AddonConfig {
  name: string;
  slug: string;
  version: string;
  arch: string[];
  ingress: boolean;
  ingress_port?: number;
  ports: Record<string, unknown>;
  map: string[];
  services: string[];
  usb: boolean;
  udev: boolean;
  options: Record<string, unknown>;
  schema: Record<string, unknown>;
}

function loadConfig(): AddonConfig {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = load(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('config.yaml did not parse to an object');
  }
  return parsed as AddonConfig;
}

describe('yapaja_go/config.yaml is valid YAML with the required HA add-on keys', () => {
  it('parses as YAML without error', () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it('has the required top-level identity fields', () => {
    const config = loadConfig();
    expect(config.name).toBe('Yapaja Go');
    expect(config.slug).toBe('yapaja_go');
    expect(typeof config.version).toBe('string');
    expect(config.version.length).toBeGreaterThan(0);
  });

  it('declares amd64 + aarch64 architectures', () => {
    const config = loadConfig();
    expect(Array.isArray(config.arch)).toBe(true);
    expect(config.arch).toContain('amd64');
    expect(config.arch).toContain('aarch64');
  });

  /**
   * `ingress_port` is deliberately NOT set in config.yaml: 8099 is already the
   * Supervisor default, and `frenck/action-addon-linter` (nightly, E08-T4)
   * rejects keys that only restate a default.
   *
   * That makes the port coupling IMPLICIT, so this test makes it explicit
   * again -- which is the more valuable assertion anyway. What actually has to
   * hold is that the port the container LISTENS on is the port Ingress will
   * dial. Asserting `typeof ingress_port === 'number'` (the previous version)
   * never checked that: it would have happily passed with a port the Core
   * does not serve.
   */
  it('is Ingress-enabled, and the container listens on exactly the Ingress port', () => {
    const config = loadConfig();
    expect(config.ingress).toBe(true);

    // Not set = Supervisor default 8099.
    const ingressPort = config.ingress_port ?? SUPERVISOR_DEFAULT_INGRESS_PORT;
    expect(Number.isInteger(ingressPort)).toBe(true);
    expect(ingressPort).toBeGreaterThan(0);

    // ... and that is the port the container is actually configured to serve.
    const initScript = readFileSync(
      join(ADDON_DIR, 'rootfs', 'etc', 'yapaja', 'init-yapaja-config.sh'),
      'utf-8',
    );
    const exported = /export_env "PORT" "(\d+)"/.exec(initScript);
    expect(exported, 'init-yapaja-config.sh must export a PORT default').not.toBeNull();
    expect(Number(exported?.[1])).toBe(ingressPort);

    const dockerfile = readFileSync(join(ADDON_DIR, 'Dockerfile'), 'utf-8');
    expect(dockerfile).toContain(`EXPOSE ${ingressPort}`);
  });

  it('is Ingress-only by default (no published ports)', () => {
    const config = loadConfig();
    expect(config.ports).toEqual({});
  });

  it('maps /share as read-write (W-16: data survives updates)', () => {
    const config = loadConfig();
    expect(Array.isArray(config.map)).toBe(true);
    expect(config.map).toContain('share:rw');
  });

  it('declares mqtt:need so bashio provides broker credentials automatically', () => {
    const config = loadConfig();
    expect(Array.isArray(config.services)).toBe(true);
    expect(config.services).toContain('mqtt:need');
  });

  it('declares usb + udev for GPS-receiver passthrough', () => {
    const config = loadConfig();
    expect(config.usb).toBe(true);
    expect(config.udev).toBe(true);
  });

  it('has the required option/schema keys from docs/04 §3 (region, mqtt_prefix, photon, gps_source, log_level, memory tuning)', () => {
    const config = loadConfig();
    const requiredKeys = [
      'region',
      'mqtt_prefix',
      'photon_enabled',
      'gps_source',
      'log_level',
      'photon_xmx_mb',
      'valhalla_memory_mb',
    ];
    for (const key of requiredKeys) {
      expect(config.options, `options.${key} missing`).toHaveProperty(key);
      expect(config.schema, `schema.${key} missing`).toHaveProperty(key);
    }
  });

  it('every options key has a matching schema key and vice versa (no orphaned entries)', () => {
    const config = loadConfig();
    const optionKeys = Object.keys(config.options).sort();
    const schemaKeys = Object.keys(config.schema).sort();
    expect(optionKeys).toEqual(schemaKeys);
  });
});

/**
 * The GUI install path (Settings -> Add-ons -> Add-on Store -> ⋮ ->
 * Repositories) only works if the Supervisor can actually FIND this add-on:
 * it requires `repository.yaml` in the repository ROOT and discovers add-ons
 * as directories exactly ONE level below that root, each holding a
 * `config.yaml`. Before `feat/gui-install-path` this package lived at
 * `ha-addon/yapaja_go/` -- two levels deep, therefore invisible, which is
 * why `docs/installation.md` §A used to warn that the store path did not
 * work. These assertions pin that layout so a future reorganisation cannot
 * silently break the one path an operator actually uses (see
 * `yapaja_go/PACKAGING.md`).
 */
describe('repository layout makes the add-on discoverable via the HA GUI', () => {
  const REPO_ROOT = join(ADDON_DIR, '..');

  it('the add-on directory sits exactly one level below the repository root', () => {
    expect(basename(ADDON_DIR)).toBe('yapaja_go');
    expect(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('a repository.yaml exists in the repository root', () => {
    expect(existsSync(join(REPO_ROOT, 'repository.yaml'))).toBe(true);
  });

  it('repository.yaml carries name, url and maintainer', () => {
    const parsed = load(readFileSync(join(REPO_ROOT, 'repository.yaml'), 'utf-8'));
    expect(typeof parsed).toBe('object');
    const repo = parsed as { name?: string; url?: string; maintainer?: string };
    expect(repo.name).toBe('Yapaja Go');
    expect(repo.url).toMatch(/^https:\/\/github\.com\/.+/);
    expect(typeof repo.maintainer).toBe('string');
    expect((repo.maintainer ?? '').length).toBeGreaterThan(0);
  });

  it('config.yaml `url` points at the same repository operators add in the store', () => {
    const config = loadConfig() as AddonConfig & { url?: string };
    const repo = load(readFileSync(join(REPO_ROOT, 'repository.yaml'), 'utf-8')) as { url?: string };
    expect(config.url).toBe(repo.url);
  });
});

/**
 * ─── DIE INSTALLATION MUSS TATSAECHLICH MOEGLICH SEIN ───────────────────────
 *
 * Diese Gruppe existiert wegen eines konkreten Fehlschlags am 2026-09-02: die
 * GUI-Installation auf einer echten HAOS-Instanz brach ab mit
 *
 *   Can't install ghcr.io/yapaja/yapaja-go-amd64:0.1.0:
 *   [403] Head ".../manifests/0.1.0": denied
 *
 * Zwei unabhaengige Fehler lagen hintereinander, und der erste verdeckte den
 * zweiten:
 *
 *   1. `config.yaml` deklarierte `image: ghcr.io/yapaja/yapaja-go-{arch}`.
 *      Steht dort ein `image:`, ZIEHT der Supervisor und baut nicht. Dieses
 *      Image existierte nie -- `yapaja` ist nicht einmal der Namensraum
 *      dieses Repositories, und kein Workflow hat `yapaja_go/Dockerfile` je
 *      gebaut oder gepusht.
 *   2. Der Dockerfile kopierte aus der REPO-WURZEL (`COPY apps/ ...`). Der
 *      Supervisor baut aber mit dem ADD-ON-VERZEICHNIS als Kontext. Waere
 *      Fehler 1 allein behoben worden, waere der Bau an
 *      „COPY failed: file not found" gescheitert.
 *
 * Die 14 bestehenden Tests dieser Datei waren dabei gruen. Sie pruefen die
 * Struktur der Konfiguration und die Auffindbarkeit im Store -- aber nichts,
 * was die Installation tatsaechlich vollzieht. Genau diese Luecke schliessen
 * die folgenden Tests.
 */
describe('die Installation kann tatsaechlich durchlaufen', () => {
  const DOCKERFILE_PATH = join(ADDON_DIR, 'Dockerfile');
  const WORKFLOW_DIR = join(ADDON_DIR, '..', '.github', 'workflows');

  /** Alle `COPY`/`ADD`-Zeilen mit ihren Quellpfaden, ohne `--from=`-Stufen
   *  (die beziehen sich auf eine vorherige Build-Stufe, nicht auf den
   *  Kontext) und ohne `--chown=`/`--chmod=`-Flags. */
  function contextCopySources(dockerfile: string): string[] {
    const sources: string[] = [];
    for (const rawLine of dockerfile.split('\n')) {
      const line = rawLine.trim();
      const match = /^(COPY|ADD)\s+(.*)$/i.exec(line);
      if (!match) continue;
      if (/--from=/i.test(match[2])) continue; // Quelle ist eine Build-Stufe
      const tokens = match[2]
        .split(/\s+/)
        .filter((t) => t.length > 0 && !t.startsWith('--'));
      // Letztes Token ist das Ziel im Image, alles davor sind Quellen.
      sources.push(...tokens.slice(0, -1));
    }
    return sources;
  }

  /**
   * DER TEST, DER DEN ZWEITEN FEHLER GEFANGEN HAETTE.
   *
   * Der Supervisor baut ein Add-on mit dem Add-on-Verzeichnis als
   * Docker-Build-Kontext -- auch beim Store-Weg, wo er zwar das ganze
   * Repository klont, aber aus `<clone>/yapaja_go/` baut. Jede `COPY`-Quelle
   * muss also innerhalb dieses Verzeichnisses liegen. `COPY ../..` ist in
   * Docker ohnehin verboten; der praktisch gefaehrliche Fall ist ein Pfad,
   * der von der Repo-Wurzel aus existiert und deshalb beim Entwickeln
   * (`docker build -f yapaja_go/Dockerfile .`) funktioniert -- und nur beim
   * echten Add-on-Bau fehlschlaegt.
   */
  it('kopiert nichts aus dem Build-Kontext, was ausserhalb von yapaja_go/ liegt', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf-8');
    const sources = contextCopySources(dockerfile);

    // Plausibilitaet: der Test waere wertlos, wenn er gar keine Zeile faende.
    expect(sources.length).toBeGreaterThan(0);

    for (const source of sources) {
      expect(source.startsWith('/'), `"${source}" ist ein absoluter Pfad`).toBe(false);
      expect(source.startsWith('..'), `"${source}" zeigt aus dem Kontext heraus`).toBe(false);
      const cleaned = source.replace(/\/$/, '');
      expect(
        existsSync(join(ADDON_DIR, cleaned)),
        `COPY-Quelle "${source}" liegt nicht in yapaja_go/ und ist beim Add-on-Bau nicht erreichbar`,
      ).toBe(true);
    }
  });

  /**
   * DER TEST, DER DEN ERSTEN FEHLER GEFANGEN HAETTE.
   *
   * Ein `image:` ist eine Zusage: „dieses Image gibt es fertig zum Ziehen".
   * Sie ist nur dann wahr, wenn irgendein Workflow `yapaja_go/Dockerfile`
   * baut UND in genau diesen Namensraum pusht. Der Test formuliert deshalb
   * eine Implikation statt eines Verbots -- wer spaeter Images
   * veroeffentlicht, darf `image:` wieder setzen, muss dann aber den
   * Workflow mitliefern.
   */
  it('deklariert `image:` nur, wenn ein Workflow dieses Image auch baut und pusht', () => {
    const config = loadConfig() as AddonConfig & { image?: string };
    if (config.image === undefined) {
      return; // Kein Versprechen gemacht -- der Supervisor baut lokal.
    }

    const workflows = existsSync(WORKFLOW_DIR)
      ? readdirSync(WORKFLOW_DIR)
          .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
          .map((f) => readFileSync(join(WORKFLOW_DIR, f), 'utf-8'))
      : [];

    // Der Namensraum ohne den `{arch}`-Platzhalter, z. B.
    // "ghcr.io/yapaja/yapaja-go-" aus "ghcr.io/yapaja/yapaja-go-{arch}".
    const namespace = config.image.split('{arch}')[0];

    const publishing = workflows.filter(
      (text) => text.includes(namespace) && text.includes('yapaja_go/Dockerfile'),
    );

    expect(
      publishing.length,
      `config.yaml verspricht das fertige Image "${config.image}", aber kein Workflow baut ` +
        `yapaja_go/Dockerfile und pusht nach "${namespace}". Genau diese Luecke liess die ` +
        `GUI-Installation am 2026-09-02 mit "403 denied" abbrechen.`,
    ).toBeGreaterThan(0);
  });

  /** Jedes Build-Argument aus `build.yaml` muss im Dockerfile als `ARG`
   *  deklariert sein -- sonst reicht der Supervisor einen Wert durch, den
   *  niemand liest, und der Bau nimmt still den Default. */
  it('jedes Argument aus build.yaml ist im Dockerfile als ARG deklariert', () => {
    const build = load(readFileSync(join(ADDON_DIR, 'build.yaml'), 'utf-8')) as {
      args?: Record<string, unknown>;
    };
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf-8');

    const args = Object.keys(build.args ?? {});
    expect(args.length).toBeGreaterThan(0);

    for (const arg of args) {
      expect(
        new RegExp(`^\\s*ARG\\s+${arg}(\\s|=|$)`, 'm').test(dockerfile),
        `build.yaml uebergibt "${arg}", der Dockerfile deklariert dafuer kein ARG`,
      ).toBe(true);
    }
  });

  /**
   * DER TEST FUER DIE DRITTE SCHICHT (2026-09-02).
   *
   * Docker kennt zwei getrennte ARG-Gueltigkeitsbereiche: alles VOR dem
   * ersten `FROM` ist global und steht jeder `FROM`-Zeile zur Verfuegung,
   * alles danach gehoert zu genau der Stufe, in der es steht. Ein `ARG`, das
   * in einer `FROM`-Zeile verwendet wird, muss deshalb global deklariert
   * sein.
   *
   * `ARG BUILD_FROM` stand unmittelbar vor der letzten `FROM`-Zeile -- aber
   * nach zwei vorherigen Stufen, also im Scope von niemandem. Der Supervisor
   * uebergab `--build-arg BUILD_FROM=...` korrekt, der Wert kam nie an:
   *
   *     ERROR: failed to solve: base name (${BUILD_FROM}) should not be blank
   *
   * Der Fehler steckte seit E08-T4 in der Datei und wurde erst sichtbar,
   * nachdem die beiden Fehler davor behoben waren und ueberhaupt zum ersten
   * Mal gebaut wurde.
   */
  it('jedes ARG, das in einem FROM verwendet wird, ist vor dem ersten FROM deklariert', () => {
    const lines = readFileSync(DOCKERFILE_PATH, 'utf-8').split('\n');
    const firstFrom = lines.findIndex((l) => /^\s*FROM\s/i.test(l));
    expect(firstFrom, 'Dockerfile enthaelt kein FROM').toBeGreaterThanOrEqual(0);

    const globalArgs = new Set<string>();
    for (const line of lines.slice(0, firstFrom)) {
      const m = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (m) globalArgs.add(m[1]);
    }

    const referenced: Array<{ name: string; line: number }> = [];
    lines.forEach((line, i) => {
      if (!/^\s*FROM\s/i.test(line)) return;
      for (const m of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
        referenced.push({ name: m[1], line: i + 1 });
      }
    });

    // Plausibilitaet: dieser Dockerfile MUSS ein ARG in einem FROM verwenden
    // (`FROM ${BUILD_FROM}`) -- sonst prueft der Test nichts.
    expect(referenced.length).toBeGreaterThan(0);

    for (const { name, line } of referenced) {
      expect(
        globalArgs.has(name),
        `Zeile ${line} benutzt \${${name}} in einem FROM, aber ARG ${name} ist nicht vor ` +
          `dem ersten FROM (Zeile ${firstFrom + 1}) deklariert. Docker expandiert es dann zu ` +
          `nichts: "base name should not be blank".`,
      ).toBe(true);
    }
  });

  /**
   * DER TEST FUER DIE VIERTE SCHICHT (2026-09-02).
   *
   * Docker fuehrt jedes `RUN` als den zuletzt gesetzten `USER` aus, und der
   * wird von `FROM` mit uebernommen. Das Valhalla-Basisimage setzt einen
   * nicht-privilegierten Benutzer, weshalb der erste `apt-get` der letzten
   * Stufe scheiterte:
   *
   *     E: Could not open lock file /var/lib/apt/lists/lock
   *        - open (13: Permission denied)
   *
   * Die letzte Stufe MUSS root sein -- nicht nur fuer apt, sondern weil
   * dieses Add-on s6-overlay als PID 1 mitbringt (`ENTRYPOINT ["/init"]`),
   * und das braucht root. Der Test verankert das an der Stelle, an der es
   * gilt: vor dem ersten `RUN` der letzten Stufe.
   */
  it('die letzte Build-Stufe setzt USER root vor ihrem ersten RUN', () => {
    const lines = readFileSync(DOCKERFILE_PATH, 'utf-8').split('\n');

    const fromIdx = lines.reduce(
      (acc, l, i) => (/^\s*FROM\s/i.test(l) ? i : acc),
      -1,
    );
    expect(fromIdx, 'Dockerfile enthaelt kein FROM').toBeGreaterThanOrEqual(0);

    const finalStage = lines.slice(fromIdx + 1);
    const firstRun = finalStage.findIndex((l) => /^\s*RUN\s/i.test(l));
    const userRoot = finalStage.findIndex((l) => /^\s*USER\s+root\s*$/i.test(l));

    // Plausibilitaet: die letzte Stufe MUSS ein RUN haben, sonst prueft der
    // Test nichts.
    expect(firstRun).toBeGreaterThanOrEqual(0);

    expect(
      userRoot,
      'Die letzte Build-Stufe setzt nirgends `USER root`. Das Basisimage ' +
        'bestimmt dann den Benutzer -- beim Valhalla-Image ist das ein ' +
        'unprivilegierter, und jedes apt-get/Schreiben nach /usr, /var oder / ' +
        'scheitert mit "Permission denied".',
    ).toBeGreaterThanOrEqual(0);

    expect(
      userRoot,
      `\`USER root\` steht erst nach dem ersten RUN der letzten Stufe ` +
        `(RUN in Zeile ${fromIdx + firstRun + 2}, USER root in Zeile ` +
        `${fromIdx + userRoot + 2}). Das erste RUN laeuft dann noch als der ` +
        `Benutzer des Basisimages.`,
    ).toBeLessThan(firstRun);
  });

  /**
   * DIE SECHSTE SCHICHT (2026-09-02): das Add-on liess sich installieren,
   * startete aber nicht.
   *
   *     s6-supervise valhalla: warning: unable to spawn ./run
   *                            (waiting 60 seconds): No such file or directory
   *
   * "No such file or directory" beim Starten einer vorhandenen, ausfuehrbaren
   * Datei heisst fast immer: der INTERPRETER aus dem Shebang fehlt. Die
   * Skripte begannen mit `#!/usr/bin/with-contenv bash`. Diesen Pfad legen
   * nur die offiziellen HA-Basisimages an; s6-overlay v3 selbst installiert
   * das Werkzeug nach `/command/with-contenv` (nachgeprueft im Release-
   * Archiv v3.1.6.2: `./command/with-contenv` ist enthalten, ein
   * `usr/bin/with-contenv` kommt darin ueberhaupt nicht vor). Wir bauen auf
   * dem Valhalla-Image, also gab es den Pfad nicht.
   */
  const ROOTFS_DIR = join(ADDON_DIR, 'rootfs');

  function rootfsScripts(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && readFileSync(full, 'utf-8').startsWith('#!')) out.push(full);
      }
    };
    walk(ROOTFS_DIR);
    return out;
  }

  it('kein Skript unter rootfs/ benutzt den HA-Basisimage-Pfad /usr/bin/with-contenv', () => {
    const scripts = rootfsScripts();
    // Plausibilitaet: ohne Skripte prueft der Test nichts.
    expect(scripts.length).toBeGreaterThan(0);

    for (const file of scripts) {
      const shebang = readFileSync(file, 'utf-8').split('\n')[0];
      expect(
        shebang.includes('/usr/bin/with-contenv'),
        `${file.replace(ADDON_DIR, 'yapaja_go')} benutzt /usr/bin/with-contenv. Den Pfad legen ` +
          `nur die offiziellen HA-Basisimages an; dieses Add-on baut auf dem Valhalla-Image ` +
          `und installiert s6-overlay v3 selbst, das /command/with-contenv mitbringt. ` +
          `s6 meldet den fehlenden Interpreter als "unable to spawn ./run: ` +
          `No such file or directory".`,
      ).toBe(false);
    }
  });

  /**
   * Die zweite Haelfte desselben Startfehlers: `init-yapaja-config.sh` lief
   * unter nacktem `bash` (das `up`-Skript rief es so auf) und scheiterte an
   * `bashio::log.info: command not found`. Ein Skript, das
   * bashio-Funktionen benutzt, muss `bashio` als Interpreter haben --
   * `bash` allein kennt sie nicht.
   */
  it('jedes Skript, das bashio:: benutzt, hat auch bashio als Interpreter', () => {
    // Kommentarzeilen zaehlen NICHT als Verwendung -- mehrere dieser Skripte
    // zitieren die Fehlermeldung `bashio::log.info: command not found` in
    // ihrem Kopfkommentar, um zu erklaeren, warum der Shebang so aussieht,
    // wie er aussieht.
    const usesBashio = (file: string): boolean =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .some((l) => !l.trimStart().startsWith('#') && l.includes('bashio::'));
    const users = rootfsScripts().filter(usesBashio);
    // Plausibilitaet: es MUSS solche Skripte geben, sonst ist der Test leer.
    expect(users.length).toBeGreaterThan(0);

    for (const file of users) {
      const shebang = readFileSync(file, 'utf-8').split('\n')[0];
      expect(
        /\bbashio\s*$/.test(shebang),
        `${file.replace(ADDON_DIR, 'yapaja_go')} benutzt bashio::-Funktionen, sein Shebang ` +
          `endet aber nicht auf "bashio": "${shebang}". Unter nacktem bash fuehrt das zu ` +
          `"bashio::…: command not found".`,
      ).toBe(true);
    }
  });

  /**
   * Und die Stelle, an der die beiden auseinanderliefen: das `up`-Skript des
   * Oneshots rief `bash /etc/yapaja/init-yapaja-config.sh` auf und umging
   * damit den Shebang des Skripts. Der Interpreter gehoert an EINE Stelle.
   */
  it('das oneshot-up-Skript umgeht den Shebang des init-Skripts nicht', () => {
    const up = readFileSync(
      join(ROOTFS_DIR, 'etc/s6-overlay/s6-rc.d/init-yapaja-config/up'),
      'utf-8',
    );
    const body = up
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#') && l.trim().length > 0)
      .join('\n');
    expect(body).toContain('/etc/yapaja/init-yapaja-config.sh');
    expect(
      /\b(bash|sh)\s+\/etc\/yapaja\/init-yapaja-config\.sh/.test(body),
      'Das up-Skript ruft init-yapaja-config.sh mit einem explizitem Interpreter auf und ' +
        'umgeht damit dessen Shebang -- genau so lief es unter nacktem bash ohne bashio.',
    ).toBe(false);
  });

  /**
   * DIE SIEBTE SCHICHT (2026-09-02): das Update kam auf dem Geraet nie an.
   *
   * Docker bildet den Cache-Schluessel einer `RUN`-Zeile aus ihrem
   * BEFEHLSTEXT, nicht aus dem, was der Befehl herunterlaedt. Stage 1 holt
   * den Quelltext von `tar.gz/main` -- ein beweglicher Zeiger, dessen Text
   * sich nie aendert. Der Schritt lief deshalb genau EINMAL und wurde danach
   * bei jedem Bau aus dem Cache genommen (`#10 ... CACHED` im Log).
   *
   * Sichtbar wurde das nicht als Fehler, sondern als scheinbar erfolgreiches
   * Update: der Supervisor liest `version:` aus dem Git-Klon und zeigte
   * 0.1.4 an, waehrend das Image den Quelltext von Stunden zuvor enthielt.
   * Zwei Releases kamen nie an.
   *
   * Der Fetch-Schritt muss deshalb einen Wert lesen, der sich pro Version
   * aendert. `BUILD_VERSION` uebergibt der Supervisor aus `config.yaml`.
   */
  it('der Quelltext-Fetch haengt am Cache-Schluessel von der Add-on-Version ab', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf-8');

    // Die RUN-Zeile, die den Quelltext holt (inkl. Fortsetzungszeilen).
    const fetchStep = dockerfile
      .split(/\n(?=[A-Z]+ )/)
      .find((block) => block.includes('codeload.github.com'));
    expect(fetchStep, 'kein Quelltext-Fetch im Dockerfile gefunden').toBeTruthy();

    expect(
      /\$\{?BUILD_VERSION\}?/.test(fetchStep ?? ''),
      'Der Quelltext-Fetch liest BUILD_VERSION nicht. Ohne einen Wert, der sich pro ' +
        'Version aendert, bleibt der Befehlstext gleich -- Docker nimmt den Schritt aus ' +
        'dem Cache und das Image behaelt ewig denselben Quelltext, obwohl der Supervisor ' +
        'eine neue Version anzeigt.',
    ).toBe(true);

    // Und das ARG muss in DERSELBEN Stufe deklariert sein, sonst ist es leer.
    const stage = (fetchStep ?? '') + dockerfile.slice(0, dockerfile.indexOf('codeload'));
    expect(
      /^\s*ARG\s+BUILD_VERSION/m.test(stage),
      'BUILD_VERSION wird im Fetch-Schritt gelesen, ist in dieser Stufe aber nicht als ' +
        'ARG deklariert -- es expandiert dann zu nichts und bustet keinen Cache.',
    ).toBe(true);
  });

  /**
   * DIE ACHTE SCHICHT (2026-09-02): das Add-on-Protokoll bestand fast nur
   * noch aus einer einzigen Zeile.
   *
   *     /usr/lib/bashio/log.sh: line 107: info: unbound variable
   *
   * bashio liest seinen Log-Level DIREKT aus der Umgebung und erwartet dort
   * eine ZAHL (lib/bashio.sh:31):
   *
   *     declare __BASHIO_LOG_LEVEL=${LOG_LEVEL:-${__BASHIO_DEFAULT_LOG_LEVEL}}
   *
   * und vergleicht ihn arithmetisch (lib/log.sh:107):
   *
   *     if [[ "${level}" -gt "${__BASHIO_LOG_LEVEL}" ]]; then
   *
   * `init-yapaja-config.sh` exportierte aber `LOG_LEVEL=info` -- einen
   * NAMEN -- in die GETEILTE Container-Umgebung. Alles unter
   * `/run/s6/container_environment/` landet in jedem `with-contenv`-Skript,
   * also auch in bashio. Der `-gt`-Vergleich wertete `info` arithmetisch aus
   * und brach unter `set -u` bei JEDEM Log-Aufruf ab. Kein s6-Dienst konnte
   * mehr protokollieren.
   *
   * Der Name gehoert deshalb nicht in die geteilte Umgebung. Der Core will
   * `LOG_LEVEL` weiterhin (pino) -- das setzt `core/run` lokal.
   */
  it('exportiert keine Variable in die geteilte Umgebung, die bashio belegt', () => {
    const init = readFileSync(
      join(ROOTFS_DIR, 'etc/yapaja/init-yapaja-config.sh'),
      'utf-8',
    );

    // Namen, die bashio selbst aus der Umgebung liest und die deshalb nicht
    // von uns global belegt werden duerfen. Jeder weitere Eintrag braucht
    // denselben Nachweis: Fundstelle in bashios Quelltext.
    const RESERVED_BY_BASHIO = ['LOG_LEVEL'];

    const exported = [...init.matchAll(/^\s*export_env\s+"([A-Z0-9_]+)"/gm)].map((m) => m[1]);
    // Plausibilitaet: ohne Exporte prueft der Test nichts.
    expect(exported.length).toBeGreaterThan(0);

    for (const reserved of RESERVED_BY_BASHIO) {
      expect(
        exported.includes(reserved),
        `init-yapaja-config.sh exportiert "${reserved}" in die geteilte ` +
          `Container-Umgebung. bashio liest genau diesen Namen (lib/bashio.sh:31) und ` +
          `erwartet eine Zahl -- ein Name wie "info" laesst jeden bashio-Log-Aufruf ` +
          `mit "unbound variable" abbrechen. Lokal im jeweiligen run-Skript setzen.`,
      ).toBe(false);
    }
  });

  /** Der Core braucht `LOG_LEVEL` trotzdem (pino). Wenn es nicht mehr global
   *  kommt, muss es lokal gesetzt werden -- sonst ist die Option des
   *  Betreibers stillschweigend wirkungslos. */
  it('core/run setzt LOG_LEVEL lokal aus YAPAJA_LOG_LEVEL', () => {
    const run = readFileSync(
      join(ROOTFS_DIR, 'etc/s6-overlay/s6-rc.d/core/run'),
      'utf-8',
    );
    expect(run).toMatch(/export\s+LOG_LEVEL=.*YAPAJA_LOG_LEVEL/);
  });

  /**
   * CHANGELOG.md ist das, was Home Assistant dem Betreiber VOR dem Klick auf
   * „Aktualisieren" anzeigt. Ein Update ohne Eintrag ist damit ein Update,
   * ueber das er nichts erfaehrt -- und weil `version:` erhoeht werden MUSS,
   * damit der Supervisor ueberhaupt eines anbietet, faellt genau dann auf,
   * wenn beides auseinanderlaeuft.
   *
   * Geprueft wird die Kopplung, nicht der Inhalt: zu jeder ausgelieferten
   * Version muss eine Ueberschrift existieren.
   */
  it('CHANGELOG.md hat einen Eintrag fuer die ausgelieferte Version', () => {
    const changelog = readFileSync(join(ADDON_DIR, 'CHANGELOG.md'), 'utf-8');
    const { version } = loadConfig();
    const heading = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\s*$`, 'm');
    expect(
      changelog,
      `CHANGELOG.md hat keine Ueberschrift "## ${version}". Home Assistant zeigt ` +
        'diese Datei beim Update an -- ohne Eintrag erfaehrt der Betreiber nicht, ' +
        'was sich aendert.',
    ).toMatch(heading);
  });

  /**
   * Ohne diesen Symlink laedt KEIN Routinggraph.
   *
   * `valhalla_build_config` backt absolute Pfade in die valhalla.json, und
   * das gis-ops-Image setzt sie hart unter `/custom_files`
   * (`scripts/helpers.sh`). `valhalla_service` startet hier aber mit
   * `/share/yapaja/valhalla/tiles/valhalla.json`. Zeigt `/custom_files`
   * nicht auf genau dieses Verzeichnis, findet der Dienst seine Kacheln
   * nicht -- und zwar unabhaengig davon, ob der Graph hier gebaut oder
   * anderswo gebaut und hereinkopiert wurde.
   */
  it('Dockerfile legt /custom_files als Symlink auf das Valhalla-Verzeichnis an', () => {
    const dockerfile = readFileSync(join(ADDON_DIR, 'Dockerfile'), 'utf-8');
    expect(
      dockerfile,
      'Ohne den Symlink /custom_files -> /share/yapaja/valhalla/tiles zeigen die ' +
        'absoluten Pfade in der von Valhalla erzeugten valhalla.json ins Leere.',
    ).toMatch(/ln\s+-s\s+\/share\/yapaja\/valhalla\/tiles\s+\/custom_files/);
  });

  /** Der Core startet dieses Werkzeug per Pfad (`GRAPH_BUILD_COMMAND`).
   *  Fehlt es im Image, scheitert der Knopf „Routing bauen" beim ersten
   *  Druck -- genau die Sorte Versprechen, die diese Datei verhindern soll. */
  it('der Wrapper fuer den Routinggraphen liegt im rootfs und ist ausfuehrbar', () => {
    const wrapper = join(ROOTFS_DIR, 'usr/bin/yapaja-build-graph');
    expect(existsSync(wrapper), `${wrapper} fehlt`).toBe(true);
    const mode = statSync(wrapper).mode;
    // eslint-disable-next-line no-bitwise -- Ausfuehrbar-Bit pruefen
    expect(mode & 0o111, 'yapaja-build-graph ist nicht ausfuehrbar').toBeGreaterThan(0);
  });

  /** `build_from` muss jede unter `arch:` genannte Architektur abdecken --
   *  sonst schlaegt der Bau genau auf der Hardware fehl, fuer die das Add-on
   *  sich zustaendig erklaert. */
  it('build.yaml nennt fuer jede unterstuetzte Architektur ein Basis-Image', () => {
    const config = loadConfig();
    const build = load(readFileSync(join(ADDON_DIR, 'build.yaml'), 'utf-8')) as {
      build_from?: Record<string, string>;
    };
    for (const arch of config.arch) {
      expect(
        build.build_from?.[arch],
        `build.yaml hat kein build_from fuer arch "${arch}"`,
      ).toBeTruthy();
    }
  });
});
