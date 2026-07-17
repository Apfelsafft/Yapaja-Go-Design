/**
 * Standalone mount entry for the widget shell (E07-T1), served at
 * `/shell.html` (see `apps/web/shell.html` + `vite.config.ts`'s multi-page
 * `rollupOptions.input`).
 *
 * The task explicitly scopes E07-T1 to the widget-registry/slot-layout
 * ENGINE, not to rewiring `App.tsx`'s existing ad-hoc layout (search bar,
 * favorites drawer, profile chip, drive overlay, ...) into slots -- that
 * would be exactly the "final UI shell" integration the task instructions
 * warn against doing here (scope creep beyond E07-T1, and real risk of
 * regressing the 30+ already-green e2e specs that assert on `App.tsx`'s
 * current DOM). This entry point mounts the shell on its own, self-contained
 * page instead: a real, working target to develop/test the engine against
 * (dev + `apps/web/e2e/shell.spec.ts`) that later E07 tasks (or whichever
 * task wires the shell in as the app's primary layout) can build on without
 * this task's code needing to change.
 *
 * `?mode=explore|drive` selects the initial shell mode (defaults to
 * `explore`); there is no mode-switcher UI yet (out of scope -- E07-T2's
 * edit-mode work is the natural place for that alongside the layout editor).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import Shell from './Shell.js';
import type { ShellMode } from '@yapaja/ui';
import '../index.css';

function readModeFromQuery(): ShellMode {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'drive' ? 'drive' : 'explore';
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Shell mode={readModeFromQuery()} />
  </React.StrictMode>,
);
