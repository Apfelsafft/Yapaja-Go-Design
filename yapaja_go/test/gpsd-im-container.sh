#!/usr/bin/env sh
# ==============================================================================
# Laeuft gpsd in diesem Image ueberhaupt?
#
# ─── WOFUER ──────────────────────────────────────────────────────────────────
# Gemeldet wurde ein Protokoll, das aussah wie ein gesunder Dienst:
#
#   [23:51:37] INFO: gpsd: benutze /dev/serial/by-id/usb-u-blox_AG_-…
#   [23:51:38] INFO: gpsd: benutze /dev/serial/by-id/usb-u-blox_AG_-…
#   [23:51:39] INFO: gpsd: benutze /dev/serial/by-id/usb-u-blox_AG_-…
#
# Im Sekundentakt, und nichts lauschte auf 2947. Der Empfaenger WAR gefunden --
# gpsd startete, starb sofort, s6 startete den Dienst neu, die Geraetesuche lief
# erneut und meldete wieder Erfolg. Nirgends stand, dass etwas fehlschlug.
#
# `command -v gpsd` haette das nicht gefunden: es beweist nur, dass eine Datei
# da ist. Deshalb wird hier GESTARTET und nachgesehen, ob jemand lauscht --
# dieselbe Frage, die die Installationspruefung auf dem Geraet stellt.
#
# Das Muster ist in diesem Image nicht neu: `osmium` fehlte einmal ganz, und
# der Suchindex-Bau brach auf dem Geraet ab, waehrend jede CI gruen war.
#
#   docker run --rm --entrypoint sh yapaja-go:ci -c "$(cat dieses-skript)"
# ==============================================================================
set -u

PORT=2947

echo "gpsd liegt unter: $(command -v gpsd || echo '<nicht im PATH>')"
if ! command -v gpsd >/dev/null 2>&1; then
  echo "FEHLER: gpsd ist im Image nicht auffindbar. PATH=${PATH}"
  exit 1
fi

gpsd -V || {
  echo "FEHLER: 'gpsd -V' scheitert -- das Programm ist da, laeuft aber nicht."
  exit 1
}

# OHNE Geraet, dafuer mit Steuersocket: gpsd verlangt mindestens eines von
# beidem. So braucht diese Pruefung keine Hardware und misst genau das, worum
# es geht -- ob der Dienst anlaeuft und lauscht.
gpsd -N -n -D 2 -F /tmp/gpsd-pruefung.sock &
GPSD_PID=$!

# Etwas Anlauf geben. Stirbt gpsd, tut es das sofort, nicht nach Sekunden.
sleep 3

if ! kill -0 "${GPSD_PID}" 2>/dev/null; then
  wait "${GPSD_PID}"
  echo "FEHLER: gpsd hat sich innerhalb von 3 s beendet (Code $?)."
  echo "Genau das ist der gemeldete Fehler: s6 startet den Dienst dann im"
  echo "Sekundentakt neu, und das Protokoll sieht aus wie Erfolg."
  exit 1
fi

# Lauscht es? Node ist im Image (der Core laeuft damit).
node -e "
  const net = require('net');
  const s = net.connect(${PORT}, '127.0.0.1');
  s.setTimeout(4000);
  s.on('connect', () => { console.log('gpsd lauscht auf 127.0.0.1:${PORT}'); s.destroy(); process.exit(0); });
  s.on('timeout', () => { console.log('FEHLER: Zeitueberschreitung auf ${PORT}'); process.exit(1); });
  s.on('error', (e) => { console.log('FEHLER: ' + e.message); process.exit(1); });
"
ERGEBNIS=$?

kill -TERM "${GPSD_PID}" 2>/dev/null || true
wait "${GPSD_PID}" 2>/dev/null || true

if [ "${ERGEBNIS}" -ne 0 ]; then
  echo "gpsd laeuft, nimmt aber keine Verbindung an -- der Core bekaeme dasselbe"
  echo "ECONNREFUSED, das im gemeldeten Protokoll steht."
  exit 1
fi

echo "gpsd startet und lauscht."
