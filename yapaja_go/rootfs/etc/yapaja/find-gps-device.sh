#!/usr/bin/env bash
# ==============================================================================
# Welches Gerät ist der GPS-Empfänger?
#
# ─── WARUM DAS NICHT „DAS ERSTE ttyACM*" SEIN DARF ───────────────────────────
# Bis 0.8.1 nahm `gpsd/run` das erste Gerät, das auf `/dev/ttyACM*` oder
# `/dev/ttyUSB*` passte. Auf einem Rechner, auf dem NUR ein GPS-Empfänger
# steckt, ist das richtig. Auf einem Home-Assistant-Rechner steckt aber fast
# immer noch etwas anderes daran -- ein Zigbee-Koordinator (SkyConnect,
# Sonoff, ConBee) oder ein Z-Wave-Stick. Die melden sich unter genau denselben
# Namen, und `config.yaml` reicht mit `usb: true` ALLE davon in den Container.
#
# Zwei Dinge gehen dann schief:
#
#  1. gpsd öffnet den Zigbee-Stick und schreibt Erkennungsmuster darauf, um
#     den Empfängertyp zu bestimmen. Das Gerät gehört aber einem anderen
#     Add-on. Im besten Fall findet Yapaia kein GPS; im schlechteren stört es
#     ein fremdes Funknetz.
#  2. Die Nummerierung ist nicht stabil. `ttyACM0` kann nach dem nächsten
#     Neustart ein anderes Gerät sein, sobald einer der Sticks dazukommt oder
#     wegfällt -- dieselbe Falle, vor der die Home-Assistant-Doku bei
#     Z-Wave- und Zigbee-Sticks ausdrücklich warnt.
#
# ─── DIE REGEL ───────────────────────────────────────────────────────────────
# Geraten wird nicht. Der Reihe nach:
#
#   1. Ist `gps_device` gesetzt, gilt genau das. Wenn es fehlt, wird NICHTS
#      anderes genommen -- wer ein Gerät benennt, bekommt kein anderes.
#   2. Sonst: ein Gerät, das sich unter `/dev/serial/by-id/` selbst als
#      GNSS-Empfänger ausweist. Diese Namen tragen Hersteller und Modell und
#      sind über Neustarts stabil.
#   3. Sonst: gibt es GENAU EIN serielles Gerät, ist es das. Bei mehreren wird
#      keines angefasst, sondern gesagt, welche zur Wahl stehen.
#
# `YAPAIA_DEV_ROOT` setzt ein anderes Wurzelverzeichnis vor `/dev` -- im
# Betrieb leer, im Test ein Temp-Verzeichnis. Nur so lässt sich diese Auswahl
# überhaupt prüfen, ohne echte Hardware anzustecken.
# ==============================================================================

# Woran ein GNSS-Empfänger in einem `by-id`-Namen zu erkennen ist.
#
# Die Liste deckt ab, was in diesen Geräten tatsächlich steckt: u-blox (der
# VK-162 trägt einen u-blox 7 und meldet sich als „u-blox_AG_-_www.u-blox.com"),
# SiRF, MediaTek, Garmin, GlobalSat. Dazu die Gattungswörter, die viele
# Empfänger im Produktnamen führen.
#
# Bewusst NICHT darin: „Silicon_Labs", „Prolific", „FTDI", „CH340". Das sind
# USB-Seriell-Wandler ohne eigene Aussage -- ein SkyConnect-Zigbee-Stick meldet
# sich genauso. Ein Name, der nichts über das Gerät sagt, darf hier nicht als
# Fund gelten; für diesen Fall gibt es Stufe 3 und die Option.
GNSS_MUSTER='u-?blox|gps|gnss|glonass|galileo|navstar|nmea|sirf|mediatek|mtk|garmin|globalsat|gmouse|g-mouse'

# Die beiden Ergebnisse von `gps_device_waehlen`: der Gerätepfad und der
# Klartext, der ins Protokoll geht.
#
# ─── WARUM ÜBER VARIABLEN UND NICHT ÜBER stdout ─────────────────────────────
# Der erste Entwurf gab den Pfad auf stdout aus, und der Aufrufer schrieb
# `DEVICE="$(gps_device_waehlen)"`. Das startet eine SUBSHELL: alles, was die
# Funktion darin setzt, ist beim Aufrufer wieder weg. Die Begründung kam damit
# nie im Protokoll an -- sie wurde gebildet, formuliert und verworfen. Genau
# der Fehler, den dieses Skript beseitigen soll, eine Ebene höher.
#
# Aufgefallen ist es nur, weil der Test die Auswahl AUSFÜHRT und die Begründung
# mitliest, statt den Quelltext nach Wörtern abzusuchen.
GPS_DEVICE_PFAD=""
GPS_DEVICE_GRUND=""

_dev() {
  printf '%s' "${YAPAIA_DEV_ROOT:-}/dev"
}

# Alle seriellen Geräte, stabile `by-id`-Pfade zuerst.
#
# `by-id` wird bevorzugt, weil der Pfad den Namen des Geräts trägt und nach
# einem Neustart derselbe ist. Fehlt das Verzeichnis (älteres System, udev
# nicht durchgereicht), bleiben die rohen Knoten.
_serielle_geraete() {
  local eintrag
  local gefunden=0
  for eintrag in "$(_dev)/serial/by-id/"*; do
    if [ -e "${eintrag}" ]; then
      printf '%s\n' "${eintrag}"
      gefunden=1
    fi
  done
  [ "${gefunden}" = "1" ] && return 0

  for eintrag in "$(_dev)/ttyACM"* "$(_dev)/ttyUSB"*; do
    if [ -e "${eintrag}" ]; then
      printf '%s\n' "${eintrag}"
    fi
  done
}

# Nur die, die sich selbst als GNSS-Empfänger ausweisen.
_gnss_geraete() {
  local eintrag
  while IFS= read -r eintrag; do
    [ -n "${eintrag}" ] || continue
    # Nur der Dateiname wird geprüft. Der Verzeichnisanteil enthält im Test
    # den Temp-Pfad, und der darf das Ergebnis nicht beeinflussen.
    if printf '%s' "${eintrag##*/}" | grep -Eqi "${GNSS_MUSTER}"; then
      printf '%s\n' "${eintrag}"
    fi
  done
}

# Setzt `GPS_DEVICE_PFAD` und `GPS_DEVICE_GRUND`. Muss OHNE `$(...)` gerufen
# werden, sonst landen beide in einer Subshell (siehe oben).
#
#   0  Gerät gefunden
#   1  kein serielles Gerät da (Empfänger nicht angesteckt)
#   2  mehrdeutig -- es wird bewusst keines gewählt
gps_device_waehlen() {
  local gewuenscht="${GPS_DEVICE:-}"
  GPS_DEVICE_PFAD=""
  GPS_DEVICE_GRUND=""

  # ─── 1. AUSDRÜCKLICH ANGEGEBEN ──────────────────────────────────────────
  if [ -n "${gewuenscht}" ]; then
    local nachtrag=""

    # ─── DER FEHLENDE SCHRÄGSTRICH ────────────────────────────────────────
    # Gemeldet mit `dev/serial/by-id/usb-u-blox_AG_…` im Feld -- ohne den
    # führenden Schrägstrich. Beim Abtippen aus der Prüfmeldung geht er
    # leicht verloren, und er ist an dieser Stelle nicht zu sehen.
    #
    # Ohne Behandlung ist das ein RELATIVER Pfad, und was er bedeutet, hängt
    # dann am Arbeitsverzeichnis des s6-Dienstes: mal trifft er zufällig das
    # Richtige, mal nichts. Genau die Sorte „geht bei mir" gehört hier nicht
    # hin. Ein Gerätepfad ist absolut; die Absicht ist unmissverständlich,
    # also wird er berichtigt -- und gesagt, dass berichtigt wurde, damit es
    # in der Konfiguration auch dauerhaft stimmt.
    case "${gewuenscht}" in
      /*) ;;
      *)
        gewuenscht="/${gewuenscht}"
        nachtrag=" Hinweis: In der Konfiguration fehlt der führende Schrägstrich; gelesen wurde '${gewuenscht}'. Bitte dort ergänzen."
        ;;
    esac

    if [ -e "${YAPAIA_DEV_ROOT:-}${gewuenscht}" ]; then
      GPS_DEVICE_PFAD="${YAPAIA_DEV_ROOT:-}${gewuenscht}"
      GPS_DEVICE_GRUND="ausdrücklich in der Add-on-Konfiguration angegeben (gps_device).${nachtrag}"
      return 0
    fi
    # KEIN Rückfall auf die Suche: wer ein Gerät benennt, bekommt kein
    # anderes. Ein stillschweigend anderes Gerät wäre genau der Fehler, den
    # diese Datei beseitigt.
    GPS_DEVICE_GRUND="gps_device ist auf '${gewuenscht}' gesetzt, aber dort liegt nichts. Es wird kein anderes Gerät genommen -- bitte den Pfad prüfen (Einstellungen -> Add-ons -> Yapaia Go -> Konfiguration) oder das Feld leeren, damit Yapaia wieder selbst sucht."
    return 1
  fi

  local alle gnss anzahl_alle anzahl_gnss
  alle="$(_serielle_geraete)"
  gnss="$(printf '%s\n' "${alle}" | _gnss_geraete)"
  anzahl_alle="$(printf '%s' "${alle}" | grep -c . || true)"
  anzahl_gnss="$(printf '%s' "${gnss}" | grep -c . || true)"

  # ─── 2. SELBST ALS GNSS AUSGEWIESEN ─────────────────────────────────────
  if [ "${anzahl_gnss}" = "1" ]; then
    GPS_DEVICE_PFAD="${gnss}"
    GPS_DEVICE_GRUND="am Namen als GNSS-Empfänger erkannt"
    return 0
  fi
  if [ "${anzahl_gnss}" -gt 1 ] 2>/dev/null; then
    GPS_DEVICE_GRUND="mehrere Geräte sehen nach einem GNSS-Empfänger aus: $(printf '%s' "${gnss}" | tr '\n' ' '). Bitte in der Add-on-Konfiguration unter 'gps_device' eintragen, welches gemeint ist."
    return 2
  fi

  # ─── 3. GENAU EINES, ALSO KEINE VERWECHSLUNG MÖGLICH ────────────────────
  if [ "${anzahl_alle}" = "1" ]; then
    GPS_DEVICE_PFAD="${alle}"
    GPS_DEVICE_GRUND="das einzige serielle Gerät im Container -- verwechseln kann man es nicht"
    return 0
  fi
  if [ "${anzahl_alle}" = "0" ]; then
    GPS_DEVICE_GRUND="kein serielles Gerät vorhanden"
    return 1
  fi

  GPS_DEVICE_GRUND="es sind mehrere serielle Geräte da, aber keines weist sich als GNSS-Empfänger aus: $(printf '%s' "${alle}" | tr '\n' ' '). Yapaia fasst keines davon an -- darunter ist womöglich Ihr Zigbee- oder Z-Wave-Stick, und gpsd würde beim Erkennen darauf schreiben. Bitte das richtige Gerät in der Add-on-Konfiguration unter 'gps_device' eintragen."
  return 2
}
