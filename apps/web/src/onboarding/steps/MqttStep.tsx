/**
 * Onboarding step 6 (optional): MQTT. In the HA add-on/ingress mode, the
 * broker is auto-configured by bashio (docs/04 §3) -- detected here via the
 * existing `GET /api/v1/auth/status` `ingress` flag (E08-T3), no new
 * detection endpoint needed. Standalone, shows a minimal broker form that
 * writes to the SAME `mqtt` settings key E08-T1's `resolveMqttConfig`
 * already reads (`apps/core/src/mqtt/config.ts`).
 */

import React, { useEffect, useState } from 'react';
import { fetchAuthStatus } from '../client.js';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

interface MqttFormValue {
  broker_url: string;
  username: string;
  password: string;
  prefix: string;
}

const BLANK: MqttFormValue = { broker_url: '', username: '', password: '', prefix: 'yapaja' };

export default function MqttStep(): React.ReactElement {
  const [ingress, setIngress] = useState<boolean | null>(null);
  const [form, setForm] = useState<MqttFormValue>(BLANK);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetchAuthStatus().then((status) => setIngress(status?.ingress ?? false));
  }, []);

  const handleSave = async (): Promise<void> => {
    setSaved(false);
    try {
      await fetch(apiUrl('api/v1/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mqtt: {
            broker_url: form.broker_url || undefined,
            username: form.username || undefined,
            password: form.password || undefined,
            prefix: form.prefix || 'yapaja',
          },
        }),
      });
      setSaved(true);
    } catch {
      // Best-effort -- offline is a normal operating mode for this app.
    }
  };

  if (ingress === null) {
    return <div data-testid="onboarding-step-mqtt" />;
  }

  if (ingress) {
    return (
      <div data-testid="onboarding-step-mqtt">
        <p
          className="rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-300"
          data-testid="onboarding-mqtt-auto-configured"
        >
          MQTT wird als Home-Assistant-Add-on automatisch konfiguriert (Broker-Zugangsdaten via
          Supervisor). Keine weitere Eingabe nötig.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="onboarding-step-mqtt">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Optional: Verbinde Yapaja Go mit einem MQTT-Broker (z. B. für Home-Assistant-Integration).
        Kann jederzeit übersprungen werden.
      </p>
      <input
        type="text"
        placeholder="Broker-URL (z. B. mqtt://192.168.1.10:1883)"
        value={form.broker_url}
        onChange={(e) => setForm((prev) => ({ ...prev, broker_url: e.target.value }))}
        className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
        data-testid="onboarding-mqtt-broker-url"
      />
      <input
        type="text"
        placeholder="Benutzername (optional)"
        value={form.username}
        onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
        className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
        data-testid="onboarding-mqtt-username"
      />
      <input
        type="password"
        placeholder="Passwort (optional)"
        value={form.password}
        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
        className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
        data-testid="onboarding-mqtt-password"
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium"
        data-testid="onboarding-mqtt-save-button"
      >
        Speichern
      </button>
      {saved && (
        <p className="text-xs text-green-700 dark:text-green-400" data-testid="onboarding-mqtt-saved">
          Gespeichert.
        </p>
      )}
    </div>
  );
}
