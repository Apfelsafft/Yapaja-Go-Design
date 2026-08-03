/**
 * Track-Recorder (E09-T5, docs/05 §6.2) -- UI entry point (the "+ Mini-UI"
 * half of this Type B add-on). Runs inside the sandboxed add-on iframe
 * exactly like `poi-campsites/src/main.ts`, and talks to the host EXCLUSIVELY
 * through `@yapaja/addon-sdk` -- no raw `fetch`/`postMessage` anywhere here
 * either (verified by `addons-examples/no-raw-transport.test.ts`).
 *
 * This file NEVER touches the recording logic directly -- it only reads the
 * "state"/"index" keys the SERVICE half (`service.ts`) writes via
 * `storage.own`, and writes "command" to ask it to start/stop. See the
 * package README for why `storage.own` (not `events.publish`) is the
 * UI<->service channel here.
 *
 * KNOWN PLATFORM LIMITATION, worked around here (documented in the README
 * and this task's final report): the add-on iframe is
 * `sandbox="allow-scripts"` WITHOUT `allow-downloads`
 * (`apps/web/src/addons/AddonHost.tsx`), so a real browser "Save As" file
 * download cannot be reliably triggered from inside it. This UI shows each
 * recorded track's full GPX XML in a plain, selectable `<pre>` (so a user can
 * copy/paste it into a `.gpx` file by hand) and ALSO attempts a best-effort
 * `<a download>` Blob-URL link, which some browsers may honor -- but the
 * `<pre>` is the one this add-on relies on actually working everywhere.
 */

import { connectAddon } from '@yapaja/addon-sdk';

const STATE_POLL_MS = 1000;
const INDEX_POLL_MS = 1500;
const WIDGET_ID = 'recorder-status';

interface RecorderState {
  recording: boolean;
  trackId: string | null;
  startedAt: string | null;
  pointCount: number;
  distanceMeters: number;
  segmentCount: number;
}

interface TrackSummary {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '00:00';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

async function main(): Promise<void> {
  const addon = await connectAddon();

  const toggleButton = document.getElementById('recorder-toggle') as HTMLButtonElement;
  const elapsedEl = document.getElementById('recorder-elapsed') as HTMLSpanElement;
  const distanceEl = document.getElementById('recorder-distance') as HTMLSpanElement;
  const pointsEl = document.getElementById('recorder-points') as HTMLSpanElement;
  const listEl = document.getElementById('track-list') as HTMLDivElement;
  const gpxViewEl = document.getElementById('track-gpx-view') as HTMLPreElement;

  let lastState: RecorderState = {
    recording: false,
    trackId: null,
    startedAt: null,
    pointCount: 0,
    distanceMeters: 0,
    segmentCount: 0,
  };

  function sendCommand(action: 'start' | 'stop'): void {
    // Date.now() as the seq: strictly increasing across UI reloads too (a
    // fresh iframe's own in-memory counter would restart at 0 and could
    // collide with a seq the service already handled from a PREVIOUS UI
    // session in the same recording -- see service.ts's doc comment).
    void addon.storage.set('command', { action, seq: Date.now() });
  }

  toggleButton.addEventListener('click', () => {
    sendCommand(lastState.recording ? 'stop' : 'start');
  });

  function renderState(): void {
    toggleButton.textContent = lastState.recording ? 'Aufnahme stoppen' : 'Aufnahme starten';
    toggleButton.dataset.recording = String(lastState.recording);
    elapsedEl.textContent = formatElapsed(lastState.recording ? lastState.startedAt : null);
    distanceEl.textContent = formatDistance(lastState.distanceMeters);
    pointsEl.textContent = String(lastState.pointCount);

    // Mirrors the same state into the shell's side-panel widget (`widget.register`)
    // -- like poi-campsites, the widget slot only renders `text`/`severity`
    // (`AddonWidgetView.tsx`), so it's a compact summary; the full controls
    // live in this iframe's own DOM.
    if (lastState.recording) {
      const text = `Aufnahme läuft · ${formatElapsed(lastState.startedAt)} · ${formatDistance(lastState.distanceMeters)}`;
      void addon.widgets.update(WIDGET_ID, { text, severity: 'info' });
    } else {
      void addon.widgets.update(WIDGET_ID, { text: 'Keine Aufnahme aktiv' });
    }
  }

  async function pollState(): Promise<void> {
    const raw = await addon.storage.get<RecorderState>('state');
    if (raw && typeof raw === 'object') {
      lastState = { ...lastState, ...raw };
      renderState();
    }
  }

  async function showGpx(track: TrackSummary): Promise<void> {
    const gpx = (await addon.storage.get<string>(`track:${track.id}`)) ?? '';
    gpxViewEl.textContent = gpx;
    gpxViewEl.dataset.trackId = track.id;

    // Best-effort download link -- see the file-level doc comment. Wrapped in
    // try/catch: Blob/URL.createObjectURL are ordinary web APIs (not
    // network I/O, so the iframe's `connect-src 'none'` CSP does not affect
    // them), but nothing here assumes the resulting click will actually
    // produce a save dialog.
    const existingLink = document.getElementById('track-download-link');
    if (existingLink) existingLink.remove();
    try {
      const blob = new Blob([gpx], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const link = el('a', {
        id: 'track-download-link',
        'data-testid': 'track-download-link',
        href: url,
        download: `${track.id}.gpx`,
        text: 'Download (falls vom Browser erlaubt)',
      });
      gpxViewEl.insertAdjacentElement('beforebegin', link);
    } catch {
      /* Blob/URL unavailable in this environment -- the <pre> above still works. */
    }
  }

  async function pollIndex(): Promise<void> {
    const index = (await addon.storage.get<TrackSummary[]>('index')) ?? [];
    listEl.innerHTML = '';
    for (const track of index) {
      const row = el('div', { class: 'track-row', 'data-testid': `track-item-${track.id}` });
      row.appendChild(
        el('span', {
          text: `${track.name} · ${formatDistance(track.distanceMeters)} · ${track.pointCount} Punkte · ${track.segmentCount} Segmente`,
        }),
      );
      const showButton = el('button', { 'data-testid': `track-show-${track.id}`, text: 'GPX anzeigen' });
      showButton.addEventListener('click', () => void showGpx(track));
      row.appendChild(showButton);
      listEl.appendChild(row);
    }
  }

  await addon.widgets.register({
    widgetId: WIDGET_ID,
    name: 'Track-Recorder',
    slots: ['side-panel'],
    data: { text: 'Keine Aufnahme aktiv' },
  });

  renderState();
  await pollState();
  await pollIndex();
  setInterval(() => void pollState(), STATE_POLL_MS);
  setInterval(() => void pollIndex(), INDEX_POLL_MS);
}

void main();
