# About these images

Every image and clip in this directory is a **real recording of the running
application**, captured automatically — nothing is mocked up, redrawn or
staged. They are produced by:

```bash
pnpm --filter @yapaia/web exec playwright test -c docs-media.config.ts
```

That run boots the production build of the core and the web app (the same
`globalSetup` the end-to-end suite uses), drives it, and writes the results
here. Re-run it whenever the interface changes visibly. It is deliberately
**not** part of CI: a capture run on every pull request would only add binary
noise to the history.

## Why the map is empty

The map background is blank in all of them, and that is a property of the test
harness, not of Yapaia.

`apps/core/src/map/__fixtures__/pmtiles-fixture.ts` generates a valid PMTiles
**header with no tiles behind it** — deliberately, because no test ever needs
drawn streets, and shipping a binary map fixture would bloat the repository.
Measured: the map canvas contains exactly one colour (`245,243,236`).

Everything Yapaia draws **itself** is real and visible: the route line, your
position marker, and every control. That is what a manual needs to show.

Producing screenshots with real streets would need an OpenStreetMap extract,
which the environment these were captured in cannot download. **Screenshots
from a real installation are welcome** — they would only need to replace the
files here under the same names.

## Contents

| File | Shows |
|---|---|
| `explore.png` | The app shell: search, vehicle chip, controls, favourites drawer |
| `fahrmodus.png` | Drive mode with everything on screen at once |
| `anweisung.png` | The manoeuvre panel, close up |
| `fahrzeugprofil.png` | The vehicle profile list |
| `favoriten.png` | The favourites and history drawer |
| `installationspruefung.png` | The health check — here with genuine failures, because neither routing nor search runs in the harness |
| `fahrt.gif` | A drive: route, position, manoeuvres counting down and switching |
| `bedienung.gif` | Opening the panels, including the health check |
