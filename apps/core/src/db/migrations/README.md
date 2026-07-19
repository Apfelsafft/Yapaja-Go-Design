# DB-Migrationen (E08-T6, Wargame W-16)

Der Migrationsrunner (`runner.ts`) ersetzt die früher inline in
`db/index.ts::createDb` liegenden `CREATE TABLE IF NOT EXISTS`-Statements.
**Datenerhalt hat Vorrang** -- Profile, Favoriten, Layouts und Onboarding-State
der Nutzer:innen dürfen ein Update niemals nicht überleben.

## Wie eine neue Migration hinzugefügt wird

1. Neue Datei `NNN_kurzer_name.ts` in diesem Verzeichnis, `NNN` = nächste freie,
   fortlaufende Nummer (aktuell zuletzt vergeben: `001_baseline.ts`).
2. Exportiert ein `Migration`-Objekt (`types.ts`):
   ```ts
   export const myMigration: Migration = {
     version: 2,
     name: '002_add_something',
     up(db) {
       db.exec(`ALTER TABLE ... `);
     },
   };
   ```
   `up` ist reines, synchrones DDL/SQL (better-sqlite3 kennt kein async).
   **Keine eigene Transaktion öffnen** -- der Runner wrapped jede Migration
   bereits in `db.transaction(...)`.
3. In `index.ts` zur `MIGRATIONS`-Liste hinzufügen (Reihenfolge = Versions-
   reihenfolge).
4. Spalten/Constraints bestehender Tabellen NIE nachträglich in
   `001_baseline.ts` ändern -- das ist die eingefrorene Ist-Schema-Momentaufnahme
   vor dem Runner. Jede echte Schemaänderung ist eine NEUE Migration.

Der Runner merkt sich den höchsten angewendeten Stand in der Tabelle
`schema_version (version, name, applied_at)` (ein Row pro erfolgreich
angewendeter Migration -- zugleich das "Migrationslog"). Ein zweiter Lauf
gegen eine bereits migrierte DB ist ein No-op (kein Backup, keine Schreibzugriffe,
deterministisch).

## Bestandsaufnahme bei Alt-Installationen ("Adoption")

Eine DB, die vor E08-T6 entstanden ist, hat die 4 Basistabellen (`profiles`,
`favorites`, `history`, `settings`) bereits, aber noch keine `schema_version`-
Tabelle. Der Runner erkennt das (`hadVersionTable == false` UND alle 4
Basistabellen existieren bereits) und **stempelt** die DB direkt auf
Baseline-Version 1, OHNE `001_baseline`'s `up()` erneut auszuführen. Damit
wird ausgeschlossen, dass eine zukünftige Migration jemals annimmt, `up()`
liefe bei einer Alt-DB nochmal mit -- selbst wenn `CREATE TABLE IF NOT EXISTS`
technisch harmlos wäre. Erst darüber hinausgehende (also `version > 1`)
Migrationen werden danach normal angewendet.

## Backups

Bevor die ERSTE ausstehende Migration eines Laufs angewendet wird, wird die
DB-Datei gesichert (`backup.ts::backupDatabase`):

1. `PRAGMA wal_checkpoint(TRUNCATE)` -- schreibt gepufferte WAL-Writes ins
   Hauptfile, damit das Backup vollständig ist (sonst könnte ein reiner
   Datei-Copy jüngste, nur im `-wal`-File stehende Schreibzugriffe verpassen).
2. Kopie nach `<dbpfad>.<timestamp>-<seq>.bak` neben der Original-Datei.
3. Rotation: es bleiben maximal **3** `.bak`-Dateien pro DB-Pfad erhalten,
   die ältesten werden gelöscht (`rotateBackups`, W-16-Plausibilität:
   "kein Disk-Fressen").

Für `:memory:`-Datenbanken (keine Datei) entfällt das Backup -- es gibt
nichts zu kopieren; In-Memory-Tests laufen unverändert weiter.

## Fehlerfall: Core verweigert den Start

Wirft eine Migration eine Exception, rollt better-sqlite3 deren Transaktion
automatisch zurück (kein Teil-Schema durch DIESE Migration), der Runner wirft
einen typisierten `MigrationError` (inkl. Version/Name/Original-Fehler), und
dieser propagiert ungefangen aus `createDb`/`getDb` durch `ProfileService.init()`
bis zu `buildServer()`/`main()` in `src/index.ts` -- der Core startet NICHT
und loggt den Fehler klar statt auf halbem Schema weiterzulaufen. Das bereits
angefertigte Backup bleibt unangetastet auf der Platte liegen.

## Manuelles Rollback

1. Core stoppen.
2. Aktuelle (möglicherweise beschädigte) DB-Datei zur Seite legen.
3. Die gewünschte `.bak`-Datei (neben der DB-Datei, z. B.
   `data/db/yapaja.db.2026-07-19T12-00-00-000Z-000001.bak`) zurück auf den
   DB-Pfad kopieren (ohne `.bak`-Suffix).
4. Core wieder starten. Da die zurückgespielte Datei die 4 Basistabellen
   (und ggf. eine ältere `schema_version`) enthält, greift beim nächsten
   Start entweder der normale Migrationspfad (falls `schema_version` schon
   vorhanden war) oder die Adoption oben.

## Was hier NICHT läuft: Upgrade-E2E

Der volle Compose-basierte Upgrade-Test (Version n−1 hochfahren, Daten
anlegen, aufs neue Image wechseln, Datenerhalt + sauberes Migrationslog
prüfen) läuft in der **Release-Pipeline** (docs/07 §6), nicht pro PR -- es
gibt vor v1.0 schlicht noch kein n−1-Release-Image. Siehe
`e2e/upgrade/README.md`. Die pro-PR-Abdeckung für den eigentlich riskanten
Teil (Alt-Schema-DB-Datei → neuer Runner übernimmt sie verlustfrei) liefert
der deterministische Baseline-Adoption-Unit-Test in `runner.test.ts`.
