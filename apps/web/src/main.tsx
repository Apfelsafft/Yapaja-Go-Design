import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CrashScreen from './shell/CrashScreen.js';
import './index.css';
import { initServiceWorker } from './pwa/registerServiceWorker.js';
import { requestPersistentStorage } from './pwa/persistentStorage.js';
import { seiteFesthalten } from './shell/seiteFesthalten.js';
import { sichtbarenBereichVerfolgen } from './shell/sichtbarerBereich.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

// E07-T5: register the SW + ask for persistent storage (W-20) as early in
// boot as possible, independent of the React render below.
initServiceWorker();
void requestPersistentStorage();
seiteFesthalten();
// Home Assistant zeigt Yapaia in einem Rahmen, der höher sein kann als der
// Bildschirm -- die Oberfläche bleibt im sichtbaren Teil (shell/sichtbarerBereich.ts).
sichtbarenBereichVerfolgen();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {/* Ohne diese Grenze raeumt React bei einem Fehler beim Zeichnen
        den GANZEN Baum ab -- der gemeldete „blanke Screen". */}
    <CrashScreen>
      <App />
    </CrashScreen>
  </React.StrictMode>
);
