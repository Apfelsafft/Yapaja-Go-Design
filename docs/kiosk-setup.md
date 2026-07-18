# Kiosk-Betrieb (E07-T5)

Yapaja Go läuft im Wohnmobil typischerweise als **Vollbild-Kiosk** auf einem
Mini-PC (N100-Klasse, siehe docs/00 §Zielhardware): kein Fenstermanager, keine
Adressleiste, kein versehentliches Wegnavigieren — der Bildschirm zeigt
ausschließlich die App, startet automatisch nach dem Boot und erholt sich
selbstständig von einem Crash. Dieses Dokument ist die Betriebsanleitung dafür.
Es referenziert und testet das bereits gebaute **W-19-Recovery** (E04-T5) statt
es zu duplizieren — siehe „Crash-Recovery" unten.

## 1. Voraussetzung: der Core läuft und liefert die App aus

Der Kiosk-Browser navigiert zu einer normalen HTTP(S)-URL des Core-Prozesses
(`docker compose up -d` bzw. das systemd-Unit unten) — standardmäßig
`http://localhost:8080/`. Der Core liefert den gebauten `apps/web/dist`
(inkl. `manifest.webmanifest`, `sw.js`, `icons/`) direkt über sein eigenes
statisches Fileserving mit aus (`apps/core/src/index.ts`, `@fastify/static`
auf `publicDir`); es ist **kein separater Webserver** für die PWA nötig.

## 2. Browserwahl & Vollbild-Flags

### Option A: Chromium/Chrome direkt (`--kiosk`)

```sh
chromium \
  --kiosk \
  --app=http://localhost:8080/ \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --disable-features=TranslateUI
```

- `--kiosk`: Vollbild ohne Fenster-Chrome, schließt auf Tastendruck/Alt-F4
  NICHT von selbst (anders als ein normales Fenster) — genau das gewollte
  Verhalten für ein fest verbautes Touch-Display ohne Tastatur.
- `--app=<url>` statt einer normalen Tab-URL: keine Adressleiste, kein
  Tab-Strip, selbst wenn `--kiosk` aus irgendeinem Grund ausfällt.
- `--noerrdialogs` / `--disable-infobars` / `--disable-session-crashed-bubble`:
  unterdrücken genau die Chromium-eigenen Popups, die sonst **nach einem
  Crash-Neustart** ("Chrome wurde nicht richtig beendet — Wiederherstellen?")
  vor die App treten würden — die App hat mit `ResumePrompt.tsx` bereits ihren
  eigenen, App-spezifischen Wiederherstellungs-Dialog (Abschnitt 4); der
  Browser-eigene Dialog darf den nicht verdecken oder doppeln.
- Die App selbst fordert `display: 'fullscreen'` im Web-App-Manifest
  (`apps/web/vite.config.ts`) an — für den Fall, dass der Kiosk stattdessen die
  PWA über den in Abschnitt 3 beschriebenen Weg **installiert** öffnet, statt
  über `--kiosk`.

### Option B: Fully Kiosk Browser (Android-Geräte / -Tablets)

Für ein Android-Tablet als Zweitbildschirm/Fahrerdisplay (statt eines
Linux-Mini-PCs) ist [Fully Kiosk Browser](https://www.fully-kiosk.com/) die
etablierte Wahl (MDM-taugliche Einstellungen, Remote-Admin, Watchdog
eingebaut):

1. **Start-URL** → `http://<core-host>:8080/`.
2. **Web Content Settings → Load in Overview Mode**: aus (die App liefert
   ihr eigenes Layout, kein Browser-Zoom-Fit nötig).
3. **Fully-Einstellungen → Kiosk-Modus**: „Enable Kiosk Mode" +
   „Auto-launch on Boot" (siehe Abschnitt 3) + „Screen Always On".
4. **Motion/Screensaver**: deaktivieren — der Kiosk-Bildschirm darf während
   der Fahrt nie in den Sleep-Modus wechseln.
5. **Fully → Motion Detection / Watchdog → "Restart App if Not Responding"**:
   aktivieren — das ist Fully's Äquivalent zu Abschnitt 4's
   Systemd-`Restart=on-failure` für den Chromium-Kiosk-Fall; siehe dortige
   Erklärung zu W-19.

Fully Kiosk Browser unterstützt Service Worker + Web-App-Manifest wie ein
normaler moderner WebView-basierter Browser — kein Sonderweg für PWA-Precache
nötig.

## 3. Autostart nach dem Boot

### systemd (Linux-Mini-PC, empfohlen für Option A)

`/etc/systemd/system/yapaja-kiosk.service`:

```ini
[Unit]
Description=Yapaja Go Kiosk
After=graphical.target network-online.target yapaja-core.service
Wants=network-online.target

[Service]
Type=simple
User=kiosk
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium --kiosk --app=http://localhost:8080/ \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-pinch --overscroll-history-navigation=0
# Crash-Recovery (W-19, siehe Abschnitt 4): Chromium selbst neu starten, egal
# WARUM es beendet wurde (Absturz, OOM-Kill, GPU-Treiber-Hang, …). Der
# Navigationszustand überlebt das, weil er im Core (nicht im Browser-Tab)
# lebt — ein neu gestarteter Chromium-Prozess verbindet sich einfach neu.
Restart=always
RestartSec=2

[Install]
WantedBy=graphical.target
```

```sh
sudo systemctl enable --now yapaja-kiosk.service
```

`yapaja-core.service` (analog, `ExecStart=docker compose -f
/opt/yapaja/docker-compose.yml up`, oder direkt `node apps/core/dist/index.js`
je nach Deployment) muss **vor** dem Kiosk-Unit starten (`After=`), sonst zeigt
der erste Kiosk-Start nur einen Verbindungsfehler — Chromiums eigenes
`Restart=always` fängt das trotzdem irgendwann ab, sobald der Core hochkommt.

### Fully Kiosk Browser (Android)

Einstellungen → „Other Settings" → „Start on Device Boot" aktivieren, plus
(falls verfügbar auf dem Gerät) die Android-eigene „Kiosk-Modus/Launcher"-
Option, damit Fully als Standard-Launcher fest verankert ist und nicht durch
z. B. einen Reboot-Dialog unterbrochen wird.

## 4. Crash-Recovery (W-19) — was der Kiosk NICHT selbst lösen muss

**Kernprinzip (docs/08 Wargame W-19, bereits in E04-T5 gebaut):
Navigationszustand lebt im Core-Prozess, nicht im Browser-Tab.** Ein
abstürzender/neu startender Chromium-Kiosk (OOM-Kill, GPU-Hang, Stromausfall
+ Neustart des ganzen Mini-PCs) verliert dadurch **nichts** — der Kiosk muss
nur dafür sorgen, dass der Browser überhaupt wieder hochkommt
(`Restart=always` oben); den Rest übernimmt die App selbst:

1. **Browser/Tab startet neu** (egal ob nach Absturz oder Boot) und lädt
   `index.html` frisch.
2. **`main.tsx`** mountet `App.tsx`, welches u. a. `DriveOverlay.tsx` und
   darin `ResumePrompt.tsx` rendert.
3. `ResumePrompt.tsx` ruft beim Mount **einmalig**
   `resume.ts#checkResumeOnLoad()` auf: `GET /api/v1/navigation/state`.
   - **Fall A — Core lief durch** (nur der Tab ist neu gestartet, der
     Core-Prozess lief die ganze Zeit weiter): `NavState.status` ist noch
     `navigating`/`off_route`/`paused`. Die App zeigt „Navigation
     fortsetzen?" (`data-testid="resume-prompt"`) — ein Klick auf
     „Fortsetzen" übernimmt den bereits laufenden Zustand direkt (kein
     erneuter Routing-Call nötig), und die Drive-UI (Manöver-Panel,
     3D-Kurskamera) erscheint. Gemessen (`apps/web/e2e/nav-control.spec.ts`,
     W-19-Test): **< 3 s** von Reload bis wieder aktiv navigierend.
   - **Fall B — auch der Core-Prozess ist neu gestartet** (z. B. der ganze
     Mini-PC hatte einen Stromausfall): `NavState.status` bootet immer zu
     `idle` (keine Ghost-Navigation, E04-T1), aber die zuletzt aktive Route
     bleibt gecacht — `recovered_route` im selben `GET
     /api/v1/navigation/state`-Response trägt ihre Referenz. Derselbe
     „Navigation fortsetzen?"-Dialog erscheint, ein Klick startet die Route
     per `POST /api/v1/navigation/start` neu.
   - **Kein Fall** (keine aktive/erholbare Navigation): der Dialog erscheint
     gar nicht erst — die App öffnet direkt normal im Explore-Modus.
   - Schlägt der Check selbst fehl (Core kurzzeitig nicht erreichbar): **fail
     open** — die App blockiert nicht, sondern läuft normal weiter, ohne
     Prompt (`resume.ts`'s `catch`-Zweig).
4. Zustand (Fahrzeugprofil, Layout, Favoriten, Settings) kommt ohnehin aus
   der SQLite-DB im Core (docs/01 ADR-006), nicht aus Browser-Storage — ein
   Tab-Neustart verliert davon nichts, unabhängig vom PWA-Service-Worker.

**Der Kiosk-Betreiber muss dafür nichts konfigurieren** — Punkte 2–4 sind
App-Verhalten, kein Kiosk-Setup. Der einzige Kiosk-seitige Beitrag ist,
zuverlässig dafür zu sorgen, dass Browser UND Core nach einem Absturz
überhaupt wieder starten (Abschnitt 3), und dass der Browser-eigene
"Session wiederherstellen?"-Dialog dabei nicht störend über dem
App-eigenen Prompt liegt (`--disable-session-crashed-bubble`, Abschnitt 2).

Automatisiert nachgewiesen in `apps/web/e2e/nav-control.spec.ts` ("W-19:
reload mid-navigation shows 'Navigation fortsetzen?' …", jetzt mit aktivem
Service Worker, siehe Abschnitt 5) und
`apps/web/e2e/pwa.spec.ts` (Cold-Start bei vollständig gekapptem Netzwerk,
Abschnitt 5).

## 5. PWA: Offline-App-Shell & Update-Verhalten

Zusätzlich zum Core-seitigen W-19-Recovery oben macht E07-T5 die App selbst
zu einer installierbaren PWA (`apps/web/vite.config.ts`, `vite-plugin-pwa`):

- **App-Shell-Precache**: der Service Worker (`dist/sw.js`) cached beim
  ersten Laden das gesamte gebaute JS/CSS/HTML — **beide** Seiten
  (`index.html` UND `shell.html`, siehe `vite.config.ts`'s Multi-Page-Build).
  Startet der Kiosk-Browser neu, während der Mini-PC selbst (nicht nur der
  Browser) kurzzeitig offline ist (z. B. WLAN-Dropout auf dem Weg zum Core,
  bei getrennter Hardware), bootet die App-Hülle trotzdem sofort aus dem
  Cache — kein weißer Bildschirm.
- **Was NIE gecacht wird**: `/api/*` und `/tiles/*` — Kartendaten und alle
  API-Antworten kommen live vom lokalen Core, nicht aus dem Service-Worker-
  Cache (`apps/web/src/pwa/cachePolicy.ts`, explizite `NetworkOnly`-Route in
  `vite.config.ts`). Ein gecachter Tile/API-Response wäre nach einem
  App-Update oder mitten in einer aktiven Fahrt schlicht falsch
  ("Geisterdaten").
- **Update-Verhalten**: neue App-Versionen aktivieren sich im Hintergrund
  automatisch (`registerType: 'autoUpdate'`), aber der sichtbare Reload wird
  **nie während der Fahrt** ausgelöst — nur im Stand, unterhalb der
  Speed-Lock-Schwelle (`apps/web/src/pwa/reloadGate.ts#shouldPromptReload`,
  wiederverwendet `drive/driveLock.ts#isSpeedLocked` aus E07-T4). Ein Kiosk
  ohne Fahrer-Interaktion (z. B. während einer längeren Rast) zeigt den
  „Update verfügbar" -Banner, sobald das Fahrzeug steht; ein Neustart des
  Kiosk-Prozesses selbst ist dafür **nicht** nötig.
- **`navigator.storage.persist()`** (W-20) wird bei jedem Start angefordert
  (`apps/web/src/pwa/persistentStorage.ts`) — reduziert, wie aggressiv der
  Browser den Origin-Storage unter Speicherdruck evakuiert. Quelle der
  Wahrheit bleibt trotzdem die Core-seitige SQLite-DB (Abschnitt 4, Punkt 4);
  das ist reine Zusatzhärtung für Caches/IndexedDB.

## 6. Manuelle Installation (optional, statt `--kiosk`-Flag)

Chromium/Fully können die PWA auch regulär „installieren" (Vollbild ohne
jede Browser-UI, App-Icon im Launcher) statt sie nur im `--kiosk`-Modus zu
öffnen:

1. `http://localhost:8080/` in Chromium öffnen.
2. Adressleisten-Icon „Installieren" (oder Chromium-Menü → „App installieren")
   — verlangt einen validen Manifest-Link + registrierten Service Worker
   (`apps/web/e2e/pwa.spec.ts` prüft genau diese Installierbarkeits-Kriterien:
   Name, ≥192px- und ≥512px-Icon, `display: fullscreen`, registrierter SW).
3. Die installierte App startet danach eigenständig im
   `display: 'fullscreen'`-Modus (aus dem Manifest, `apps/web/vite.config.ts`)
   — Autostart-Verankerung (Abschnitt 3) zeigt dann auf die installierte
   App statt auf `chromium --kiosk --app=...`.
