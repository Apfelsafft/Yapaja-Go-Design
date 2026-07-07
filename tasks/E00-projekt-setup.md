# E00 – Projekt-Setup & Fundament

**Ziel:** Lauffähiges Monorepo mit CI, Docker-Basis, Shared-Schemata und
App-Skeletons. Nach E00 kann jedes weitere Epic parallel andocken.
**Gate G0:** CI grün; `docker compose up` startet Core; `GET /api/v1/health` antwortet;
leere React-Shell lädt im Browser.

---

## E00-T1: Monorepo-Grundgerüst

- **Abhängigkeiten:** keine · **Kontext-Dokumente:** docs/01 §3
- **Berührte Pfade:** Repo-Wurzel, `apps/core`, `apps/web`, `packages/shared`
- **Erlaubte neue Dependencies:** pnpm, typescript, eslint (+typescript-eslint), prettier, vitest, fastify, react, react-dom, vite, @vitejs/plugin-react, tailwindcss, zustand

**Aufgabe:** Erstelle ein pnpm-Workspace-Monorepo `yapaja-go` mit der Struktur aus
docs/01 §3 (nur `apps/core`, `apps/web`, `packages/shared`; übrige Ordner als
`.gitkeep`). Konfiguriere: TypeScript strict (gemeinsame `tsconfig.base.json`,
ESM, `moduleResolution: bundler` im Web / `node16` im Core), ESLint flat config +
Prettier, Vitest je Paket, Root-Skripte `lint`, `typecheck`, `test`, `build`, `dev`.
`apps/core`: Fastify-Server (Port 8080, konfigurierbar via `PORT`), Endpunkt
`GET /api/v1/health` → `{status:'ok', version:<aus package.json>, services:{}}`,
strukturiertes Logging (pino), graceful shutdown (SIGTERM). `apps/web`: Vite-React-
App, rendert Platzhalter-Shell „Yapaja Go" mit Tailwind; Dev-Proxy `/api` → 8080.
**Wichtig (W-15):** Vite `base: './'` und ausschließlich relative Asset-Pfade.
`packages/shared`: leeres Paket mit Beispiel-Export und Test.

**Akzeptanzkriterien:**
1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` grün.
2. `pnpm dev` startet Core+Web; Browser zeigt Shell; `/api/v1/health` liefert 200 mit korrektem Schema.
3. Web-Build funktioniert unter Sub-Pfad (Nachweis: `vite preview` mit `--base /sub/` oder statischer Serve unter Prefix).

**Pflicht-Tests:** health-Route (Statuscode, Schema); shared-Beispiel-Test.
**Plausibilitäts-Checks:** `version` im health entspricht package.json; Shutdown beendet Prozess < 3 s.

---

## E00-T2: Shared-Schemata & Typgenerierung

- **Abhängigkeiten:** E00-T1 · **Kontext-Dokumente:** docs/03 §1 komplett, §5
- **Berührte Pfade:** `packages/shared`
- **Erlaubte neue Dependencies:** ajv, json-schema-to-ts (oder typebox — dann durchgängig)

**Aufgabe:** Lege in `packages/shared/schemas/` JSON-Schemata für ALLE Typen aus
docs/03 §1 an (`Position`, `VehicleProfile`, `RouteRequest`, `Route`, `Maneuver`,
`NavState`, plus `LatLng`, Fehlerformat). Exportiere daraus TS-Typen und
kompilierte ajv-Validatoren (`validatePosition(data)` etc.). Implementiere
zusätzlich das Modul `plausibility.ts` mit den Invarianten aus docs/03 §5 als
reine Funktionen (`checkPosition`, `checkNavState`, `checkRoute` → `{ok, violations[]}`).
Wertebereiche der Schemata exakt wie dokumentiert (z. B. `height_m: 1.0–4.5`).

**Akzeptanzkriterien:**
1. Jeder Typ hat Schema + generierten Typ + Validator; ein Index exportiert alles.
2. `plausibility.ts` deckt alle Invarianten aus docs/03 §5 ab.
3. Andere Pakete können `@yapaja/shared` importieren (Core nutzt es ab E02).

**Pflicht-Tests:** je Schema min. 1 gültiges + 2 ungültige Beispiele;
Plausibilität: Tabellentests inkl. Grenzwerte (speed 249.9 ok / 250 fail; alt −450/4900;
speed_limit 0 fail, null ok; Route-Distanz 3.9×/4.1× Luftlinie).
**Plausibilitäts-Checks:** Grenzwerte stimmen zeichengenau mit docs/03 überein.

---

## E00-T3: Docker & Compose-Basis

- **Abhängigkeiten:** E00-T1 · **Kontext-Dokumente:** docs/01 §2 (ADR-008), §4; docs/04 §4
- **Berührte Pfade:** `apps/core/Dockerfile`, `docker-compose.yml`, `services/valhalla`, `services/photon`, `.dockerignore`

**Aufgabe:** Multi-Stage-Dockerfile für den Core (Build web+core, Runtime
`node:20-slim`, non-root, Web-Build wird vom Core statisch ausgeliefert,
HEALTHCHECK auf `/api/v1/health`). `docker-compose.yml` mit Services `core`,
`valhalla` (Image `ghcr.io/valhalla/valhalla`, Volume `./data/valhalla`),
`photon` (Volume `./data/photon`, `profiles: ["search"]` → optional startbar,
W-12) — Valhalla/Photon zunächst ohne Daten, Core-Health meldet sie als `down`
(degraded, nicht crash). Persistente Volumes: `./data/{db,tiles,addons}`.
Env-Vars dokumentiert in `.env.example`.

**Akzeptanzkriterien:**
1. `docker compose up core` → Web-UI unter :8080 erreichbar, health `status:'degraded'` mit `services.valhalla:'down'`.
2. Image < 350 MB; läuft als non-root; Neustart verliert keine Daten in `./data`.
3. `docker compose --profile search up` startet zusätzlich Photon.

**Pflicht-Tests:** CI-Job baut das Image und prüft health im Container (curl).
**Plausibilitäts-Checks:** Kein Secret im Image (`docker history` stichprobenartig).

---

## E00-T4: CI-Pipeline (GitHub Actions)

- **Abhängigkeiten:** E00-T1–T3 · **Kontext-Dokumente:** docs/07 §6
- **Berührte Pfade:** `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`

**Aufgabe:** PR-Workflow: pnpm-Cache → lint → typecheck → unit/contract-Tests →
build → Docker-Build → Container-Healthcheck. Nightly-Workflow (cron): zusätzlich
Docker-Multi-Arch (amd64/arm64, nur Build) und `pnpm audit` (Fail bei High/Critical).
Concurrency-Gruppen (alte Läufe canceln), Laufzeitziel PR < 15 min. Badge ins README.

**Akzeptanzkriterien:** PR-Workflow läuft auf diesem Repo grün; Nightly manuell
triggerbar (`workflow_dispatch`) und grün.
**Pflicht-Tests:** — (der Workflow selbst ist der Test)
**Plausibilitäts-Checks:** Ein absichtlich eingebauter Lint-Fehler in einem
Test-PR lässt die Pipeline nachweislich fehlschlagen (im PR dokumentieren, dann fixen).
