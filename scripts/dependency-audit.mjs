#!/usr/bin/env node
/**
 * dependency-audit.mjs — Dependency-Audit-Gate (E10-T4, docs/07 §7).
 *
 * ─── Was dieses Gate tut (und was ausdruecklich nicht) ───────────────────────
 *
 * BLOCKIEREND ist genau EIN Umfang: die **Produktions-Abhaengigkeiten**
 * (`pnpm audit --prod`). Ein High- oder Critical-Advisory dort laesst den Job
 * rot werden, es sei denn, es steht mit Begruendung UND Ablaufdatum in
 * `security/audit-exceptions.json`.
 *
 * NICHT blockierend, aber IMMER sichtbar: alles, was nur an Dev-Werkzeugen
 * haengt (vitest, vite, esbuild, tsup, playwright …). Diese Pakete werden nie
 * auf das Geraet ausgeliefert — das Docker-Image installiert mit
 * `--prod` (apps/core/Dockerfile), das HA-Add-on ebenso. Ein Fund in vitest
 * ist deshalb ein Aufraeum-Ticket, kein Release-Blocker. Er wird trotzdem bei
 * JEDEM Lauf ausgegeben und in die Job-Summary geschrieben, damit die
 * Entscheidung "nicht blockierend" eine bewusste bleibt und nicht zu
 * "unsichtbar" verkommt. Das ist die bewusste, dokumentierte Scoping-
 * Entscheidung dieses Gates — kein stiller `--prod`-Schalter, der Funde
 * verschwinden laesst.
 *
 * ─── Warum zwei Scanner ──────────────────────────────────────────────────────
 *
 * `pnpm audit` fragt die npm-Advisory-Datenbank (GitHub Advisories). Der
 * zweite Scanner, **osv-scanner**, fragt osv.dev und findet dadurch auch
 * Advisories, die (noch) keinen npm-Eintrag haben. Er laeuft in CI (siehe
 * `.github/workflows/ci.yml`, Job `dependency-audit`) und schreibt sein
 * JSON-Ergebnis in eine Datei, die hier per `--osv <datei>` eingelesen wird —
 * so gilt fuer BEIDE Scanner dieselbe Ausnahme-Datei und dieselbe
 * Prod/Dev-Trennung, statt zwei getrennter Regelwerke.
 *
 * osv-scanner kennt selbst keine Prod/Dev-Unterscheidung fuer pnpm-Workspaces
 * (es liest die Lockfile als Ganzes). Die Trennung passiert deshalb hier: die
 * Menge der Produktionspakete kommt aus `pnpm list -r --prod --depth Infinity`
 * und OSV-Funde ausserhalb dieser Menge werden wie Dev-Funde behandelt.
 *
 * ─── Ausnahmen ──────────────────────────────────────────────────────────────
 *
 * `security/audit-exceptions.json`. Jeder Eintrag braucht `id`, `package`,
 * `reason`, `expires` (YYYY-MM-DD) und `owner`. Maschinell erzwungen wird:
 *   • abgelaufen                → FEHLER (eine Ausnahme verlaengert sich nie
 *                                 von selbst),
 *   • Ablauf > 90 Tage entfernt → FEHLER (Plausibilitaetsregel der Aufgabe),
 *   • Begruendung zu duenn      → FEHLER.
 * Eine leere Datei ist der Normalzustand und wird angestrebt.
 *
 * Verwendung:
 *   node scripts/dependency-audit.mjs [--osv <datei>] [--summary <datei.md>]
 *   node scripts/dependency-audit.mjs --check-exceptions   (nur Datei pruefen)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');

/** Ausnahmen laufen spaetestens nach dieser Frist ab (Plausibilitaet E10-T4). */
export const MAX_EXCEPTION_DAYS = 90;

/** Diese Schweregrade lassen das Gate im Prod-Umfang rot werden. */
export const BLOCKING_SEVERITIES = ['critical', 'high'];

const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3, unknown: 4 };

export const EXCEPTIONS_PATH = join(REPO_ROOT, 'security', 'audit-exceptions.json');

// ─── Findings ────────────────────────────────────────────────────────────────

/**
 * Ein Fund, normalisiert ueber beide Scanner hinweg.
 * @typedef {{id: string, package: string, version: string, severity: string,
 *            title: string, patched: string, path: string, scanner: string}} Finding
 */

function normalizeSeverity(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.trim().toLowerCase();
  if (s in SEVERITY_ORDER) return s === 'medium' ? 'moderate' : s;
  return 'unknown';
}

/**
 * CVSS-Basisscore → Schweregrad-Band (CVSS v3.1 qualitative Skala). Nur fuer
 * OSV-Eintraege noetig, die kein `database_specific.severity` mitbringen.
 */
export function severityFromCvssScore(score) {
  const n = typeof score === 'number' ? score : Number.parseFloat(String(score));
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 9.0) return 'critical';
  if (n >= 7.0) return 'high';
  if (n >= 4.0) return 'moderate';
  if (n > 0) return 'low';
  return 'unknown';
}

export function isBlockingSeverity(severity) {
  return BLOCKING_SEVERITIES.includes(normalizeSeverity(severity));
}

/** Stabiler Schluessel fuer "derselbe Fund" ueber beide Scanner hinweg. */
export function findingKey(finding) {
  return `${finding.id}|${finding.package}|${finding.version}`;
}

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.package.localeCompare(b.package) ||
      a.id.localeCompare(b.id),
  );
}

// ─── Parser: pnpm audit ──────────────────────────────────────────────────────

/**
 * Wandelt die JSON-Ausgabe von `pnpm audit --json` in {@link Finding}s um.
 * @param {unknown} report
 * @returns {Finding[]}
 */
export function parsePnpmAudit(report) {
  const advisories = report && typeof report === 'object' ? report.advisories : null;
  if (!advisories || typeof advisories !== 'object') return [];
  /** @type {Finding[]} */
  const out = [];
  for (const advisory of Object.values(advisories)) {
    const findings = Array.isArray(advisory.findings) ? advisory.findings : [];
    const versions = [...new Set(findings.map((f) => f.version).filter(Boolean))];
    const paths = [...new Set(findings.flatMap((f) => (Array.isArray(f.paths) ? f.paths : [])))];
    out.push({
      id: advisory.github_advisory_id ?? String(advisory.id ?? 'UNKNOWN'),
      package: advisory.module_name ?? 'unknown',
      version: versions.join(', '),
      severity: normalizeSeverity(advisory.severity),
      title: advisory.title ?? '',
      patched: advisory.patched_versions ?? '',
      path: paths.join(' | '),
      scanner: 'pnpm-audit',
    });
  }
  return out;
}

// ─── Parser: osv-scanner ─────────────────────────────────────────────────────

/**
 * Wandelt die JSON-Ausgabe von `osv-scanner --format json` in {@link Finding}s
 * um. Der Schweregrad kommt bevorzugt aus `database_specific.severity`
 * (GHSA-Angabe), sonst aus dem `max_severity` der zugehoerigen Gruppe
 * (CVSS-Score), sonst `unknown`.
 *
 * `unknown` wird NICHT blockierend behandelt — aber gezaehlt und ausgegeben,
 * damit ein Scanner-Formatwechsel als "N Funde ohne Schweregrad" auffaellt
 * und nicht stillschweigend zu "keine Funde" wird.
 *
 * @param {unknown} report
 * @returns {Finding[]}
 */
export function parseOsvReport(report) {
  const results = report && typeof report === 'object' ? report.results : null;
  if (!Array.isArray(results)) return [];
  /** @type {Finding[]} */
  const out = [];
  for (const result of results) {
    const source = result?.source?.path ?? '';
    for (const pkg of Array.isArray(result?.packages) ? result.packages : []) {
      const name = pkg?.package?.name ?? 'unknown';
      const version = pkg?.package?.version ?? '';
      const groups = Array.isArray(pkg?.groups) ? pkg.groups : [];
      for (const vuln of Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities : []) {
        const id = vuln?.id ?? 'UNKNOWN';
        const aliases = Array.isArray(vuln?.aliases) ? vuln.aliases : [];
        let severity = normalizeSeverity(vuln?.database_specific?.severity);
        if (severity === 'unknown') {
          const group = groups.find(
            (g) => Array.isArray(g?.ids) && g.ids.some((gid) => gid === id || aliases.includes(gid)),
          );
          if (group?.max_severity) severity = severityFromCvssScore(group.max_severity);
        }
        out.push({
          id,
          package: name,
          version,
          severity,
          title: vuln?.summary ?? '',
          patched: '',
          path: source,
          scanner: 'osv-scanner',
          aliases,
        });
      }
    }
  }
  return out;
}

// ─── Prod-Paketmenge ─────────────────────────────────────────────────────────

/**
 * Flacht die Ausgabe von `pnpm list -r --prod --depth Infinity --json` zu einer
 * Menge `name@version` ab. Damit werden OSV-Funde (die die gesamte Lockfile
 * sehen) auf den ausgelieferten Teil eingegrenzt.
 * @returns {Set<string>}
 */
export function collectProdPackages(listJson) {
  const set = new Set();
  const walk = (deps) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, node] of Object.entries(deps)) {
      if (!node || typeof node !== 'object') continue;
      if (node.version) set.add(`${name}@${node.version}`);
      walk(node.dependencies);
    }
  };
  for (const project of Array.isArray(listJson) ? listJson : []) {
    walk(project?.dependencies);
    walk(project?.optionalDependencies);
  }
  return set;
}

export function isProdFinding(finding, prodPackages) {
  if (!finding.version) return prodPackages.has(finding.package);
  // `pnpm audit` kann mehrere betroffene Versionen in einem Advisory buendeln.
  return finding.version
    .split(',')
    .map((v) => v.trim())
    .some((v) => prodPackages.has(`${finding.package}@${v}`));
}

// ─── Ausnahme-Datei ──────────────────────────────────────────────────────────

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON_LENGTH = 30;

export function loadExceptions(path = EXCEPTIONS_PATH) {
  if (!existsSync(path)) return { exceptions: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.exceptions)) {
    throw new Error(`${path}: erwartet wird ein Objekt mit dem Array-Feld "exceptions"`);
  }
  return parsed;
}

export function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Prueft die Ausnahme-Datei. Gibt die Liste der Fehler zurueck (leer = ok).
 * Bewusst streng: eine Ausnahme, die sich nicht selbst rechtfertigt oder
 * unbegrenzt laeuft, ist keine Ausnahme, sondern eine stille Abschaltung.
 * @returns {string[]}
 */
export function validateExceptions(exceptions, now = new Date()) {
  const errors = [];
  const seen = new Set();
  exceptions.forEach((entry, index) => {
    const at = `exceptions[${index}]`;
    for (const field of ['id', 'package', 'reason', 'expires', 'owner']) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim().length === 0) {
        errors.push(`${at}: Pflichtfeld "${field}" fehlt oder ist leer`);
      }
    }
    if (errors.some((e) => e.startsWith(at))) return;

    const key = `${entry.id}|${entry.package}`;
    if (seen.has(key)) errors.push(`${at}: doppelter Eintrag fuer ${key}`);
    seen.add(key);

    if (entry.reason.trim().length < MIN_REASON_LENGTH) {
      errors.push(
        `${at}: "reason" ist mit ${entry.reason.trim().length} Zeichen zu duenn ` +
          `(mindestens ${MIN_REASON_LENGTH}) — die Begruendung muss erklaeren, warum der Fund ` +
          `das ausgelieferte Produkt nicht trifft oder warum er jetzt nicht behebbar ist`,
      );
      return;
    }
    if (!DATE_PATTERN.test(entry.expires)) {
      errors.push(`${at}: "expires" muss das Format YYYY-MM-DD haben (ist: "${entry.expires}")`);
      return;
    }
    const expires = new Date(`${entry.expires}T23:59:59Z`);
    if (Number.isNaN(expires.getTime())) {
      errors.push(`${at}: "expires" ist kein gueltiges Datum ("${entry.expires}")`);
      return;
    }
    const remaining = daysBetween(now, expires);
    if (remaining < 0) {
      errors.push(
        `${at}: Ausnahme fuer ${entry.id} (${entry.package}) ist am ${entry.expires} ABGELAUFEN ` +
          `(vor ${Math.abs(remaining)} Tagen) — beheben oder mit neuer Begruendung erneuern`,
      );
    } else if (remaining > MAX_EXCEPTION_DAYS) {
      errors.push(
        `${at}: Ablaufdatum ${entry.expires} liegt ${remaining} Tage in der Zukunft; ` +
          `erlaubt sind hoechstens ${MAX_EXCEPTION_DAYS} Tage (docs/07 §7, E10-T4-Plausibilitaet)`,
      );
    }
  });
  return errors;
}

/**
 * Teilt Prod-Funde in blockierend / durch Ausnahme gedeckt.
 * Eine Ausnahme greift nur bei exakt passender `id` (oder einem OSV-Alias) UND
 * passendem Paketnamen — nie paketweit.
 */
export function applyExceptions(findings, exceptions) {
  const blocking = [];
  const excepted = [];
  for (const finding of findings) {
    if (!isBlockingSeverity(finding.severity)) continue;
    const ids = [finding.id, ...(finding.aliases ?? [])];
    const match = exceptions.find(
      (e) => ids.includes(e.id) && e.package === finding.package,
    );
    if (match) excepted.push({ finding, exception: match });
    else blocking.push(finding);
  }
  return { blocking, excepted };
}

export function countBySeverity(findings) {
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

export function formatCounts(findings) {
  const counts = countBySeverity(findings);
  const parts = Object.keys(SEVERITY_ORDER)
    .filter((s, i, arr) => arr.indexOf(s) === i && counts[s])
    .map((s) => `${counts[s]} ${s}`);
  return `${findings.length} Advisories${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function runPnpm(args) {
  try {
    return execFileSync('pnpm', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // `pnpm audit` beendet sich mit != 0, sobald es Advisories gibt — die
    // Ausgabe auf stdout ist dann trotzdem das vollstaendige JSON.
    if (typeof err?.stdout === 'string' && err.stdout.trim().length > 0) return err.stdout;
    throw err;
  }
}

function parseArgs(argv) {
  const opts = { osv: null, summary: null, checkOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--osv') opts.osv = argv[++i];
    else if (argv[i] === '--summary') opts.summary = argv[++i];
    else if (argv[i] === '--check-exceptions') opts.checkOnly = true;
    else throw new Error(`Unbekannte Option: ${argv[i]}`);
  }
  return opts;
}

function renderFinding(f) {
  const patched = f.patched ? ` → behoben in ${f.patched}` : '';
  return (
    `  [${f.severity.toUpperCase()}] ${f.package}@${f.version || '?'} ${f.id}${patched}\n` +
    `      ${f.title}\n` +
    (f.path ? `      Pfad: ${f.path}\n` : '')
  );
}

function main(argv) {
  const opts = parseArgs(argv);
  const lines = [];
  const say = (line = '') => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };

  // 1. Ausnahme-Datei zuerst — eine kaputte Ausnahme-Datei ist selbst ein
  //    Gate-Fehler, unabhaengig davon, ob es gerade Funde gibt.
  const exceptionsFile = loadExceptions();
  const exceptions = exceptionsFile.exceptions;
  const exceptionErrors = validateExceptions(exceptions);
  say('=== Ausnahme-Datei (security/audit-exceptions.json) ===');
  if (exceptions.length === 0) {
    say('  leer — keine offenen Ausnahmen. (Sollzustand.)');
  } else {
    for (const e of exceptions) {
      say(`  ${e.id} (${e.package}) laeuft ab am ${e.expires} — ${e.owner}`);
      say(`      ${e.reason}`);
    }
  }
  if (exceptionErrors.length > 0) {
    say('');
    say('FEHLER in der Ausnahme-Datei:');
    for (const err of exceptionErrors) say(`  - ${err}`);
    say('');
    say('GATE ROT.');
    return 1;
  }
  if (opts.checkOnly) {
    say('Ausnahme-Datei ist gueltig.');
    return 0;
  }

  // 2. Beide Umfaenge einlesen.
  const prodReport = JSON.parse(runPnpm(['audit', '--prod', '--json']));
  const fullReport = JSON.parse(runPnpm(['audit', '--json']));
  const prodPackages = collectProdPackages(
    JSON.parse(runPnpm(['list', '-r', '--prod', '--depth', 'Infinity', '--json'])),
  );

  let prodFindings = parsePnpmAudit(prodReport);
  const allFindings = parsePnpmAudit(fullReport);
  const prodKeys = new Set(prodFindings.map(findingKey));
  let devFindings = allFindings.filter((f) => !prodKeys.has(findingKey(f)));

  // 3. osv-scanner (laeuft nur in CI — siehe Modulkopf).
  let osvNote = 'nicht ausgefuehrt (kein --osv <datei> uebergeben)';
  if (opts.osv) {
    const osvPath = resolve(REPO_ROOT, opts.osv);
    if (!existsSync(osvPath)) {
      // Fail CLOSED: ein fehlender Report darf nie als "nichts gefunden"
      // durchgehen.
      say('');
      say(`FEHLER: osv-scanner-Report "${osvPath}" existiert nicht.`);
      say('GATE ROT.');
      return 1;
    }
    const osvFindings = parseOsvReport(JSON.parse(readFileSync(osvPath, 'utf8')));
    const osvProd = osvFindings.filter((f) => isProdFinding(f, prodPackages));
    const osvDev = osvFindings.filter((f) => !isProdFinding(f, prodPackages));
    // Duplikate zwischen den Scannern zusammenfuehren (gleiche GHSA-ID).
    const known = new Set(prodFindings.map((f) => `${f.id}|${f.package}`));
    prodFindings = [
      ...prodFindings,
      ...osvProd.filter(
        (f) => ![f.id, ...(f.aliases ?? [])].some((id) => known.has(`${id}|${f.package}`)),
      ),
    ];
    devFindings = [...devFindings, ...osvDev];
    osvNote = `${osvFindings.length} Funde (${osvProd.length} in Produktions-Abhaengigkeiten)`;
  }

  // 4. Bewertung.
  const { blocking, excepted } = applyExceptions(sortFindings(prodFindings), exceptions);

  say('');
  say('=== BLOCKIEREND: Produktions-Abhaengigkeiten ===');
  say(`  Umfang: pnpm audit --prod${opts.osv ? ' + osv-scanner (auf Prod-Pakete gefiltert)' : ''}`);
  say(`  Ergebnis: ${formatCounts(sortFindings(prodFindings))}`);
  say(`  Schwelle: ${BLOCKING_SEVERITIES.join('/')} lassen den Job fehlschlagen`);
  if (blocking.length === 0) {
    say('  Keine offenen High/Critical-Advisories. ✓');
  } else {
    say('');
    for (const f of blocking) process.stdout.write(renderFinding(f));
  }
  if (excepted.length > 0) {
    say('');
    say('  Durch Ausnahme gedeckt (laeuft ab!):');
    for (const { finding, exception } of excepted) {
      say(`    ${finding.id} ${finding.package} — bis ${exception.expires}, ${exception.owner}`);
    }
  }

  say('');
  say('=== NICHT BLOCKIEREND: reine Dev-Abhaengigkeiten ===');
  say('  Diese Pakete werden nie ausgeliefert (Image-Install laeuft mit --prod),');
  say('  darum sind sie kein Release-Blocker — aber sie bleiben hier sichtbar.');
  say(`  Ergebnis: ${formatCounts(sortFindings(devFindings))}`);
  for (const f of sortFindings(devFindings)) process.stdout.write(renderFinding(f));

  say('');
  say(`osv-scanner: ${osvNote}`);
  say('');
  say(blocking.length === 0 ? 'GATE GRUEN.' : `GATE ROT — ${blocking.length} offene(r) Fund(e).`);

  if (opts.summary) {
    writeFileSync(opts.summary, `## Dependency-Audit-Gate\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  }
  return blocking.length === 0 ? 0 : 1;
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`dependency-audit: ${err?.message ?? String(err)}\n`);
    process.exit(2);
  }
}
