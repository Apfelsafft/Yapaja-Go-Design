# Upgrade-E2E (E08-T6, Wargame W-16)

Compose-basierter Test: Version **n-1** (letztes Release-Image) starten,
über die echte REST-API ein Profil, einen Favoriten und einen
Settings-Eintrag anlegen, denselben Daten-Volume auf das **neue** Image
umstellen, und dann prüfen: alle Daten noch da + Migrationslog
(`schema_version`) sauber (lückenlos, aufsteigend, keine Duplikate).

## Warum das NICHT pro PR läuft

Dieser Test braucht ein tatsächliches **n-1-Release-Image** (`PREV_IMAGE`).
Vor v1.0 gibt es kein solches Vorgänger-Release -- ein PR-Job könnte also
nichts Sinnvolles gegen sich selbst testen (n-1 == n wäre kein Upgrade-Test,
nur ein Neustart-Test). Laut Task-Spec (`tasks/E08-home-assistant.md`
E08-T6) läuft dieser Test daher in der **Release-Pipeline**
(docs/07-testing-qa.md §6 "Release": "Nightly-Suite + ... + Update von
Vorversion ohne Kartendaten-Verlust", siehe auch §7 Release-Gate-Checkliste
G4) -- er ist NICHT in `.github/workflows/ci.yml` als Merge-Blocker verdrahtet
und soll das auch nicht sein, solange kein n-1-Image existiert.

Ab dem ersten getaggten Release (`vX.Y.Z`-Image in der Registry) kann eine
Release-Pipeline-Stage wie folgt aussehen:

```yaml
- name: Upgrade-E2E (n-1 -> n)
  env:
    PREV_IMAGE: ghcr.io/<org>/yapaja-core:${{ steps.prev_tag.outputs.tag }}
    NEW_IMAGE: ghcr.io/<org>/yapaja-core:${{ github.ref_name }}
  run: e2e/upgrade/run-upgrade-test.sh
```

## Manuell ausführen

```bash
PREV_IMAGE=ghcr.io/<org>/yapaja-core:v0.9.0 \
NEW_IMAGE=ghcr.io/<org>/yapaja-core:v1.0.0 \
  ./e2e/upgrade/run-upgrade-test.sh
```

Beide Env-Vars sind PFLICHT (keine Defaults) -- stillschweigend "das aktuelle
Build" für beide zu nehmen würde den Sinn eines Upgrade-Tests unterlaufen.
Das Skript:

1. startet `PREV_IMAGE` gegen ein frisches benanntes Docker-Volume
   (`upgrade-db`, siehe `docker-compose.yml`),
2. legt per REST (`POST /api/v1/profiles`, `POST /api/v1/favorites`,
   `PATCH /api/v1/settings`) Testdaten an,
3. stoppt den alten Container (Volume bleibt erhalten),
4. startet `NEW_IMAGE` gegen DASSELBE Volume -- das ist exakt der Pfad, den
   `createDb`'s Migrationsrunner (`apps/core/src/db/migrations/`) bei einem
   echten In-Place-Update durchläuft,
5. prüft per REST, dass Profil/Favorit/Settings noch da sind,
6. liest `schema_version` direkt aus der Container-DB-Datei (via
   `docker compose exec ... node -e "..."`, nutzt das im Image bereits
   vorhandene `better-sqlite3`) und prüft: nicht leer, aufsteigend, keine
   Lücken/Duplikate ("Migrationslog sauber").

Bei Fehlschlag druckt das Skript die Core-Container-Logs und räumt danach
(via `trap cleanup EXIT`) in jedem Fall auf (`docker compose down -v`).

## Per-PR-Abdeckung des riskantesten Teils

Der eigentlich gefährliche Teil eines Upgrades -- eine ALTE DB-Datei (Schema
vor dem Migrationsrunner, ohne `schema_version`) trifft auf den NEUEN Runner
und darf dabei keine Daten verlieren -- ist deterministisch und OHNE Docker
als Unit-Test abgedeckt:
`apps/core/src/db/migrations/runner.test.ts`, Describe-Block
`"runMigrations -- baseline adoption (no data loss)"`. Der baut eine
Datei-DB exakt so, wie `createDb` sie vor E08-T6 hinterlassen hätte (4
Tabellen, ein Profil-Row, keine `schema_version`-Tabelle), lässt den echten
Runner darüber laufen und prüft: Version == Baseline UND das Profil-Row
existiert unverändert. Das läuft in JEDEM PR (`npx vitest run`).
