import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initServiceWorker } from './pwa/registerServiceWorker.js';
import { requestPersistentStorage } from './pwa/persistentStorage.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

// E07-T5: register the SW + ask for persistent storage (W-20) as early in
// boot as possible, independent of the React render below.
initServiceWorker();
void requestPersistentStorage();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
