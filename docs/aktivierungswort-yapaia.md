# Aktivierungswort „Yapaia“ für Home-Assistant-Sprachsatelliten

Gewünscht: „Wenn es ein Wakeword braucht, nimm bitte ‚Yapaia‘.“

Yapaia selbst hört nicht dauerhaft zu. Das macht der **Sprachsatellit**
(z. B. Home Assistant Voice PE oder ein ESPHome-Gerät mit Mikrofon) bzw. der
Assist-Knopf der Home-Assistant-App. Diese Seite erklärt, was ohne eigenes
Wort sofort geht und wie man „Yapaia“ als eigenes Aktivierungswort trainiert.

> Stand: Oktober 2026. Die Menüs von Home Assistant ändern sich gelegentlich —
> wenn ein Punkt anders heißt, gilt die aktuelle Home-Assistant-Dokumentation
> unter <https://www.home-assistant.io/voice_control/>.

## Sofort, ohne Training

1. In Yapaia: **⚙ → Sprache & Home Assistant → In Home Assistant einrichten**.
   Yapaia legt den Helfer „Yapaia Sprachbefehl“ und die Automation
   „Yapaia Sprachbefehle“ an.
2. Am Satelliten das vorhandene Aktivierungswort verwenden („Okay Nabu“,
   „Hey Jarvis“ …) und danach den Befehl sprechen — mit oder ohne „Yapaia“:
   - „Okay Nabu — Yapaia, fahre mich nach Magdeburg.“
   - „Okay Nabu — wo ist die nächste Tankstelle?“
   - „Okay Nabu — stoppe die Navigation.“
3. In der Home-Assistant-App: Assist öffnen (Mikrofon-Symbol) und den Befehl
   sprechen. Das funktioniert auch über `http://`, weil die App das Mikrofon
   selbst bedient.

Nutzt die Assist-Pipeline einen KI-Gesprächsagenten (OpenAI, Claude, Google,
Ollama …), muss dort **„Befehle bevorzugt lokal verarbeiten“** eingeschaltet
sein. Sonst beantwortet die KI den Satz selbst, und er erreicht die
Yapaia-Automation nicht.

## Eigenes Aktivierungswort „Yapaia“ trainieren

Home Assistant nutzt zwei Arten von Aktivierungswort-Erkennung:

| Wo erkannt wird | Technik | Eigenes Wort |
|---|---|---|
| Im Home-Assistant-Server | **openWakeWord** (Add-on) | gut machbar — Training im Browser (Google Colab), Ergebnis als Datei ins Add-on |
| Direkt auf dem Satelliten (Voice PE, ESPHome) | **microWakeWord** | möglich, aber aufwendiger; Modell muss in die ESPHome-Firmware |

**Empfehlung:** openWakeWord im Server. Dann reicht ein Satellit, der den Ton
an Home Assistant weitergibt.

### Schritt für Schritt (openWakeWord)

1. **Training:** Das openWakeWord-Projekt stellt ein Colab-Notizbuch zum
   automatischen Training bereit (in der Projektbeschreibung unter
   „Training New Models“). Als Zielwort `yapaia` eintragen und zusätzlich die
   Schreibweise eintragen, wie man es ausspricht, z. B. `ja pa ja`. Das
   Notizbuch erzeugt künstliche Sprachbeispiele und trainiert daraus ein
   Modell (Dauer: rund eine Stunde). Ergebnis: eine Datei `yapaia.tflite`.
2. **Ins Add-on legen:** In Home Assistant das Add-on **openWakeWord**
   installieren. Die Datei `yapaia.tflite` nach `/share/openwakeword/` legen
   (z. B. mit dem Add-on „File editor“ oder „Samba share“). Add-on neu
   starten.
3. **Pipeline:** Einstellungen → Sprachassistenten → die Pipeline öffnen →
   **Aktivierungswort**: openWakeWord, Wort **yapaia**.
4. **Satellit:** In den Geräteeinstellungen des Satelliten die
   Aktivierungswort-Erkennung „in Home Assistant“ wählen (statt „auf dem
   Gerät“), damit das eigene Modell verwendet wird.

Danach genügt: **„Yapaia, fahre mich nach Magdeburg.“** Das Wort „Yapaia“
weckt den Satelliten; die Yapaia-Automation versteht den Rest auch dann,
wenn die Spracherkennung das Wort noch einmal mitschreibt.

### Tipps

- Mehrere Sprecher (verschiedene Stimmen) im Notizbuch erhöhen die
  Trefferquote im Fahrzeug.
- Fehlauslöser durch Radio oder Gespräche: im openWakeWord-Add-on die
  Schwelle („threshold“) etwas erhöhen.
- Fahrgeräusche: ein Satellit mit Richtmikrofon nahe am Fahrer hilft mehr
  als jedes Training.
