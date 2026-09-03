# Schriftzeichen für die Kartenbeschriftung (SDF-Glyphen)

## Warum das hier liegt

MapLibre kann **keinen einzigen Buchstaben** zeichnen, ohne eine
`glyphs`-Quelle im Stil. Bis 0.3.6 hatten unsere Stile keine — die Karte
führte zwar Symbol-Ebenen für Orte und POIs, aber es erschien nie Text.
Gemeldet wurde das als „die Karten sehen irgendwie langweilig aus"; eine
Karte ohne Ortsnamen ist tatsächlich kaum zu gebrauchen.

Nachgewiesen im laufenden Browser, nicht vermutet: `map.getStyle().glyphs`
war `null`, bei sechs vorhandenen Symbol-Ebenen.

## Warum die Dateien im Repo liegen und nicht beim Bauen geladen werden

Das Add-on baut auf dem Gerät des Betreibers. Jeder Download beim Bauen ist
eine Stelle, an der die Installation scheitern kann — davon hatten wir genug.
Die Glyphen sind zusammen 1,4 MB; das ist neben einem Kachelarchiv von
mehreren hundert MB nichts. Dafür braucht der Kartentext nie Netz.

Sie liegen unter `apps/web/public/`, weil Vite diesen Ordner unverändert nach
`apps/web/dist` kopiert, was im Add-on-Image zu `apps/core/public` wird und
unter `/` ausgeliefert wird. Damit gibt es keine neue Route, keinen neuen
COPY-Schritt und keine Änderung an der CSP — und der Pfad funktioniert unter
dem HA-Ingress-Unterpfad genauso wie unter `/` (W-15), weil die Stile ihn
seitenrelativ angeben (`./fonts/…`), genau wie die Kacheln.

## Herkunft

| | |
|---|---|
| Schrift | Noto Sans, Regular und Bold |
| Quelle | `raw.githubusercontent.com/openmaptiles/fonts/master/noto-sans/` |
| Lizenz | SIL Open Font License 1.1 — siehe `LICENSE-NotoSans.txt` |
| Erzeugt mit | [fontnik](https://github.com/mapbox/fontnik) 0.7.7 |

Noto Sans ist die Schrift, mit der auch die OpenMapTiles-Stile gesetzt sind —
die Karte sieht damit aus wie eine Karte und nicht wie ein Dokument.

## Warum die Ordner `noto-sans-regular` statt `Noto Sans Regular` heißen

MapLibre setzt für `{fontstack}` genau das ein, was in `text-font` steht. Der
Wert muss kein echter Schriftname sein — er ist nur der Schlüssel, unter dem
die Dateien liegen. Ohne Leerzeichen bleiben Pfad, URL und `COPY` im
Dockerfile frei von Kodierungsfragen. `baseLayers.ts` setzt entsprechend
`text-font: ['noto-sans-regular']`.

Fordert ein Stil einen Schriftschnitt an, den es hier nicht gibt, zeichnet
MapLibre die betroffene Ebene **ohne jeden Text** und meldet es nur in der
Browserkonsole. Genau davor schützt `baseLayers.fonts.test.ts`: der Test liest
die `text-font`-Werte aller Stile und prüft für jeden, dass die Dateien auf der
Platte liegen.

## Abgedeckte Zeichenbereiche

`0-255` (Latein + Latin-1), `256-511` (Latin Extended-A: Polnisch,
Tschechisch, Ungarisch, Türkisch …), `512-767`, `768-1023` (Diakritika,
Griechisch), `1024-1279` (Kyrillisch), `7680-7935` (Latin Extended
Additional), `8192-8447` (Typografie: Halbgeviertstrich, Anführungszeichen).

Das deckt Europa ab. Ein nicht abgedecktes Zeichen fehlt einzeln — es legt
nicht die Beschriftung lahm.

## Neu erzeugen

```bash
npm install fontnik@0.7.7
# NotoSans-Regular.ttf / NotoSans-Bold.ttf aus der Quelle oben holen
node scripts/generate-glyphs.mjs   # siehe scripts/
```
