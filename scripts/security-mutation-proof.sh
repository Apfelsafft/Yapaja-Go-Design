#!/usr/bin/env bash
#
# E09-T6, Akzeptanzkriterium 2 -- MUTATIONS-NACHWEIS.
#
# "Suite bricht nachweislich, wenn man eine Schutzmaßnahme deaktiviert."
#
# Dieses Skript beweist das ausführbar statt behauptend:
#
#   0. BASISLAUF -- die betroffenen Tests laufen unverändert GRÜN.
#      (Ohne diesen Schritt wäre ein späteres Rot wertlos: es könnte jede
#      beliebige Ursache haben.)
#   1. MUTATION A -- die Source-Pinning-Prüfung wird aus
#      `apps/web/src/addons/bridge.ts` ENTFERNT. Echter Patch auf echtem
#      Quellcode: KEIN Feature-Flag, KEINE injizierbare "Schutz aus"-Naht --
#      der Punkt ist, den ECHTEN Produktionscodepfad zu prüfen.
#      -> `VEKTOR bridge.source_spoofed` MUSS rot werden.
#   2. MUTATION B -- der Default-Deny der Add-on-Routenmatrix
#      (`apps/core/src/addons/scopeMatrix.ts#matchAddonRoute`) wird auf
#      "unbekannte Route = erlaubt" gedreht.
#      -> `VEKTOR core.scope_denied` MUSS rot werden.
#
# Erfolg (Exit 0) NUR, wenn der Basislauf grün war UND beide mutierten Läufe
# rot waren. Der Quellstand wird über eine `trap` BEDINGUNGSLOS
# wiederhergestellt (auch bei Ctrl-C oder Abbruch), und am Ende wird
# verifiziert, dass der Arbeitsbaum für die berührten Dateien sauber ist.
#
# Aufruf:  bash scripts/security-mutation-proof.sh   (oder: pnpm security:mutation-proof)
# Laufzeit: 3 Suite-Läufe inkl. Build + dediziertem Core, ca. 4-6 min.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRIDGE_FILE="apps/web/src/addons/bridge.ts"
MATRIX_FILE="apps/core/src/addons/scopeMatrix.ts"
MUTATED_FILES=("$BRIDGE_FILE" "$MATRIX_FILE")
CONFIG="e2e/security/playwright.config.ts"

fail() {
  echo "::error::$*" >&2
  exit 1
}

# --- Bedingungslose Wiederherstellung --------------------------------------
# Wiederhergestellt wird aus einer BYTE-GENAUEN Kopie, nicht mit
# `git checkout --`: letzteres würde bei einem (aus welchem Grund auch immer)
# unsauberen Arbeitsbaum echte, ungespeicherte Arbeit vernichten. Der
# Sauberkeits-NACHWEIS am Ende läuft trotzdem über git (siehe Schritt 3) --
# er vergleicht den `git status` der berührten Dateien vor und nach dem Lauf.
BACKUP_DIR="$(mktemp -d)"
for f in "${MUTATED_FILES[@]}"; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp "$f" "$BACKUP_DIR/$f"
done
STATUS_BEFORE="$(git status --porcelain -- "${MUTATED_FILES[@]}")"

restore() {
  for f in "${MUTATED_FILES[@]}"; do
    [ -f "$BACKUP_DIR/$f" ] && cp "$BACKUP_DIR/$f" "$f"
  done
}

cleanup() {
  restore
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT INT TERM

# $1 = -g-Filter (Regex auf den Testtitel)
run_suite() {
  npx playwright test -c "$CONFIG" -g "$1"
}

echo "==============================================================="
echo "0/3  BASISLAUF (unverändert) -- muss GRÜN sein"
echo "==============================================================="
if ! run_suite 'VEKTOR (bridge\.source_spoofed|core\.scope_denied)'; then
  fail "Der BASISLAUF ist bereits rot. Der Mutations-Nachweis wäre damit wertlos -- erst die Suite reparieren."
fi
echo "Basislauf grün."

echo
echo "==============================================================="
echo "1/3  MUTATION A: Source-Pinning aus $BRIDGE_FILE entfernen"
echo "==============================================================="

python3 - "$BRIDGE_FILE" <<'PYEOF' || fail "Mutation A konnte nicht angewendet werden -- hat sich bridge.ts geändert? Dann diesen Anker hier nachziehen."
import sys

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
needle = 'if (event.source !== this.iframe.contentWindow) {'
if needle not in src:
    raise SystemExit('anchor not found in ' + path)
# Der EINZIGE Vertrauensanker des Hosts faellt weg: jedes Fenster darf reden.
open(path, 'w', encoding='utf-8').write(src.replace(needle, 'if (false) {', 1))
print('mutated: ' + path)
PYEOF

git --no-pager diff --stat -- "$BRIDGE_FILE"

if run_suite 'VEKTOR bridge\.source_spoofed'; then
  fail "MUTATION A: die Suite blieb GRÜN, obwohl das Source-Pinning entfernt wurde -- sie erkennt den Wegfall dieser Schutzmaßnahme NICHT."
fi
echo "MUTATION A: Suite ist wie gefordert ROT geworden."
restore
echo "Quellstand wiederhergestellt."

echo
echo "==============================================================="
echo "2/3  MUTATION B: Default-Deny in $MATRIX_FILE aushebeln"
echo "==============================================================="

python3 - "$MATRIX_FILE" <<'PYEOF' || fail "Mutation B konnte nicht angewendet werden -- hat sich scopeMatrix.ts geändert? Dann diesen Anker hier nachziehen."
import sys

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
needle = '\n'.join([
    '    if (ok) return { rule, params };',
    '  }',
    '  return null;',
    '}',
])
if needle not in src:
    raise SystemExit('anchor not found in ' + path)
replacement = '\n'.join([
    '    if (ok) return { rule, params };',
    '  }',
    '  // MUTATION (scripts/security-mutation-proof.sh): default-ALLOW statt',
    '  // des echten default-DENY -- jede unbekannte Route wird zur scope-',
    '  // freien Regel.',
    "  return { rule: { method: upper, path, scope: null, note: 'mutated' }, params: {} };",
    '}',
])
open(path, 'w', encoding='utf-8').write(src.replace(needle, replacement, 1))
print('mutated: ' + path)
PYEOF

git --no-pager diff --stat -- "$MATRIX_FILE"

if run_suite 'VEKTOR core\.scope_denied'; then
  fail "MUTATION B: die Suite blieb GRÜN, obwohl der Default-Deny ausgehebelt wurde -- sie erkennt den Wegfall dieser Schutzmaßnahme NICHT."
fi
echo "MUTATION B: Suite ist wie gefordert ROT geworden."
restore

echo
echo "==============================================================="
echo "3/3  Wiederherstellung verifizieren"
echo "==============================================================="
for f in "${MUTATED_FILES[@]}"; do
  cmp -s "$BACKUP_DIR/$f" "$f" || fail "$f entspricht nach dem Lauf NICHT mehr dem Ausgangsstand."
done
STATUS_AFTER="$(git status --porcelain -- "${MUTATED_FILES[@]}")"
if [ "$STATUS_BEFORE" != "$STATUS_AFTER" ]; then
  fail "git status der mutierten Dateien hat sich verändert. Vorher: [$STATUS_BEFORE] Nachher: [$STATUS_AFTER]"
fi
if [ -z "$STATUS_AFTER" ]; then
  echo "Arbeitsbaum sauber -- keine Mutation ist zurückgeblieben."
else
  echo "::warning::Der Arbeitsbaum war für die mutierten Dateien schon VOR dem Lauf nicht sauber;"
  echo "::warning::er ist jetzt byte-identisch wiederhergestellt, aber weiterhin nicht committet:"
  echo "$STATUS_AFTER"
fi

echo
echo "MUTATIONS-NACHWEIS BESTANDEN:"
echo "  * Basislauf grün."
echo "  * Ohne Source-Pinning ($BRIDGE_FILE) wird die Suite rot."
echo "  * Ohne Default-Deny ($MATRIX_FILE) wird die Suite rot."
exit 0
