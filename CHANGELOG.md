# Changelog

Alle nennenswerten Änderungen an Yapaja Go werden hier festgehalten.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

**Herkunft dieser Datei:** Der eigentliche, pro Release erzeugte Inhalt
stammt aus [Changesets](https://github.com/changesets/changesets)
(`.changeset/`, konfiguriert in `.changeset/config.json`) — konkret aus
`apps/core/CHANGELOG.md` (dort landen die Einträge, weil `@yapaja/core` die
Version trägt, gegen die die Add-on-API geprüft wird, Wargame W-11).
`scripts/sync-root-changelog.mjs` übernimmt den jeweils neuesten Abschnitt
von dort automatisch hierher — als Teil von `.github/workflows/release.yml`.
**Nicht von Hand bearbeiten**, außer im `[Unreleased]`-Abschnitt.

Ein Changeset mit `major`-Bump auf `@yapaja/core` oder `@yapaja/addon-sdk`
(die Add-on-API-Grenze) muss einen eigenen `## Breaking Change`-Abschnitt
benennen — maschinell erzwungen von `scripts/changeset-breaking-check.mjs`
(CI-Gate, nicht nur Konvention) — und erscheint dadurch **explizit** auch
hier im Changelog, nicht nur als Versionssprung ohne Erklärung.

## [Unreleased]

Noch keine veröffentlichte Version. Das erste reale Release (`v1.0.0`) ist
Gegenstand von `tasks/E10-qualitaet-release.md` §E10-T6 — dieser Eintrag
und der komplette Release-Mechanismus (dieses Dokument, `.changeset/`,
`.github/workflows/release.yml`) sind das Ergebnis von §E10-T5 (Prozess),
nicht bereits ein durchgeführtes Release.
