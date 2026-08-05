#!/usr/bin/env bash
#
# osm-restriction-provenance.sh — belegt die Restriktions-Faelle der
# Golden-Route-Suite AUS DEM DATENSATZ, auf dem der Router tatsaechlich routet
# (E10-T3, Wargame W-08).
#
# ─── Warum nicht Overpass? ────────────────────────────────────────────────────
# Weil die falsche Frage beantwortet wuerde. Relevant ist NICHT "steht das
# maxheight-Tag heute in der Live-OSM-Datenbank?", sondern "steht es in der
# PBF, aus der der Valhalla-Graph gebaut wurde?". Nur das Zweite entscheidet,
# ob der Router die Beschraenkung ueberhaupt sehen kann. Der naechtliche Job
# `golden-routes-de` laedt diese PBF ohnehin schon herunter — dieses Skript
# liest die Belege aus DERSELBEN Datei. Zusaetzlicher Nebeneffekt: es
# funktioniert in Umgebungen ohne Overpass-Zugang (Build-Sandbox, Air-Gap).
#
# ─── Was es tut ───────────────────────────────────────────────────────────────
#   verify   Fuer jeden restriction-Fall in e2e/golden-routes.json: alle Wege
#            mit maxheight/maxweight/maxwidth in (bzw. knapp um) dessen
#            forbidden_bbox extrahieren, way-id + Tagwert ausgeben und den
#            fertigen `restriction`-Block ausgeben, der in die Fixture
#            uebernommen werden kann. Findet es nichts, gibt es AUSDRUECKLICH
#            keinen Block aus — ein erfundener osm_way_id waere schlimmer als
#            eine offen dokumentierte Luecke.
#   discover Die real getaggten, am staerksten bindenden Beschraenkungen einer
#            Art im ganzen Extrakt auflisten. Damit wird ein Fall, den `verify`
#            nicht bestaetigen konnte, durch einen BELEGTEN ersetzt statt
#            zurechtgeraten.
#
# ─── Usage ────────────────────────────────────────────────────────────────────
#   scripts/osm-restriction-provenance.sh verify   <pbf> [--fail-on-unconfirmed]
#   scripts/osm-restriction-provenance.sh discover <pbf> <maxheight|maxweight|maxwidth> [limit]
#
# Beispiele:
#   scripts/osm-restriction-provenance.sh verify data/germany-latest.osm.pbf
#   scripts/osm-restriction-provenance.sh discover data/germany-latest.osm.pbf maxwidth 40
#
# Voraussetzungen: osmium-tool (Debian/Ubuntu: apt-get install -y osmium-tool)
# und pnpm (der TS-Teil laeuft ueber das bereits vorhandene tsx aus
# @yapaja/core — KEINE neue Abhaengigkeit).
#
# Artefakte: e2e/golden-routes/.tmp/ (gitignored) — der Zwischenextrakt und
# der maschinenlesbare Report, den der nightly-Job als Artefakt hochlaedt.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$REPO_ROOT/e2e/golden-routes/.tmp"
CLI="$REPO_ROOT/e2e/golden-routes/provenanceCli.ts"

usage() {
  sed -n '3,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

if [ "$#" -lt 2 ]; then
  usage >&2
  exit 1
fi

MODE="$1"
PBF="$2"
shift 2

case "$MODE" in
  verify|discover) ;;
  *) echo "FEHLER: Modus muss 'verify' oder 'discover' sein (war: $MODE)." >&2; exit 1 ;;
esac

command -v osmium >/dev/null 2>&1 || {
  echo "FEHLER: osmium (osmium-tool) nicht im PATH. Installation (Debian/Ubuntu): apt-get install -y osmium-tool" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || { echo "FEHLER: pnpm nicht im PATH gefunden." >&2; exit 1; }

if [ ! -f "$PBF" ]; then
  echo "FEHLER: PBF-Datei nicht gefunden: $PBF" >&2
  exit 1
fi
PBF="$(cd "$(dirname "$PBF")" && pwd)/$(basename "$PBF")"

mkdir -p "$TMP_DIR"
FILTERED="$TMP_DIR/restriction-ways.osm.pbf"
GEOJSON="$TMP_DIR/restriction-ways.geojsonseq"

# Ein EINZIGER Durchlauf ueber die (bei Deutschland mehrere GB grosse) PBF
# statt eines Extrakts pro Fall: tags-filter behaelt per Default die von den
# Treffer-Ways referenzierten Nodes, damit `osmium export` gleich darauf
# Geometrien bauen kann.
echo "== [1/3] Filtere Wege mit Mass-Restriktions-Tags aus $(basename "$PBF") =="
osmium tags-filter --overwrite -o "$FILTERED" "$PBF" \
  w/maxheight w/maxheight:physical w/maxheight:signed \
  w/maxweight w/maxweight:signed w/maxweightrating \
  w/maxwidth w/maxwidth:physical w/maxwidth:signed

# --add-unique-id=type_id schreibt "@id":"w123" in die Properties; genau
# darauf ist der Parser in e2e/golden-routes/provenance.ts ausgelegt (er
# akzeptiert defensiv auch die anderen von osmium bekannten id-Schreibweisen).
echo "== [2/3] Exportiere GeoJSONSeq (mit way-ids) =="
osmium export --overwrite \
  --geometry-types=linestring,polygon \
  --add-unique-id=type_id \
  -f geojsonseq \
  -o "$GEOJSON" "$FILTERED"

SOURCE_LABEL="$(basename "$PBF") (extract used for the Valhalla graph; filtered $(date -u +%Y-%m-%dT%H:%M:%SZ))"

echo "== [3/3] Werte gegen e2e/golden-routes.json aus =="
cd "$REPO_ROOT"
if [ "$MODE" = "verify" ]; then
  pnpm --filter @yapaja/core exec tsx "$CLI" verify \
    --candidates "$GEOJSON" \
    --region de \
    --source-label "$SOURCE_LABEL" \
    --out "$TMP_DIR/provenance-report.json" \
    "$@"
else
  KIND="${1:-maxheight}"
  LIMIT="${2:-25}"
  pnpm --filter @yapaja/core exec tsx "$CLI" discover \
    --candidates "$GEOJSON" \
    --kind "$KIND" \
    --limit "$LIMIT" \
    --out "$TMP_DIR/discover-$KIND.json"
fi
