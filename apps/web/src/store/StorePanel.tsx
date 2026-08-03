/**
 * Add-on Store panel (E09-T7, docs/05 §5, Wargame W-11/W-13). Follows the
 * SAME toggle-FAB + floating panel pattern as `RegionsPanel.tsx` (E01-T5) --
 * top-right, stacked BELOW MapLibre's own NavigationControl AND RegionsPanel's
 * FAB (`top-36` vs. RegionsPanel's `top-20` -- see the `return`'s own comment
 * for the exact pixel math) so the two "Store" surfaces (the region/map one
 * and this add-on one, see `driveLock.ts`'s `'store'` vs. `'addon-store'`
 * doc comment) never overlap each other OR MapLibre's zoom/compass controls.
 *
 * Structure:
 *  - "Katalog" tab: registry catalog cards (icon, description, scope
 *    preview, screenshots) -> click opens the detail view (in-panel, no
 *    router in this app) -> "Installieren" starts the two-step
 *    scope-confirm flow that already exists server-side (E09-T1) -> a local
 *    "job progress" state machine narrates begin/confirm/done.
 *    core_api-INCOMPATIBLE entries render a blocking notice INSTEAD of an
 *    install button (acceptance criterion 2, Wargame W-11) -- computed by
 *    the Core (`compatible` field) so this is never re-implemented here.
 *  - "Updates" tab: every INSTALLED add-on that has a newer, VALID registry
 *    entry, installed-version vs. registry-version, with the SAME
 *    compatibility gate as the catalog. Also the only place this app
 *    currently offers enable/disable/uninstall for an installed add-on (no
 *    other surface exists yet -- see `apps/web/src/addons/` header docs).
 *  - Offline banner (W-13): the cache's age ("Stand: ..."), a manual sync
 *    button, and an ALWAYS-VISIBLE, upload-install section that is called
 *    out more prominently the moment a sync fails or nothing has ever been
 *    synced -- "the store must stay usable with cache + upload" holds even
 *    if a user never manually retries the sync button.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { compareVersions } from '@yapaja/shared';
import { useUiStore } from '../ui/store.js';
import DriveLockGate from '../drive/DriveLockGate.js';
import { fetchAddons, type InstalledAddon } from '../addons/client.js';
import {
  fetchRegistryCatalog,
  syncRegistry,
  beginInstallFromUrl,
  beginInstallFromUpload,
  confirmPendingInstall,
  enableAddon,
  disableAddon,
  uninstallAddonById,
  arrayBufferToBase64,
  StoreApiError,
  type RegistryCatalog,
  type RegistryEntryView,
  type PendingInstall,
} from './client.js';

type InstallFlowState =
  | { kind: 'idle' }
  | { kind: 'beginning'; label: string }
  | { kind: 'confirming'; label: string; pending: PendingInstall }
  | { kind: 'installing'; label: string }
  | { kind: 'done'; label: string }
  | { kind: 'error'; label: string; message: string };

function formatCacheAge(ageMs: number | null): string {
  if (ageMs === null) return 'noch nie synchronisiert';
  if (ageMs < 60_000) return 'gerade eben aktualisiert';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `Stand: vor ${minutes} Minute${minutes === 1 ? '' : 'n'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Stand: vor ${hours} Stunde${hours === 1 ? '' : 'n'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Stand: vor ${days} Tag${days === 1 ? '' : 'en'}`;
  const weeks = Math.floor(days / 7);
  return `Stand: vor ${weeks} Woche${weeks === 1 ? '' : 'n'}`;
}

/** True when `registryVersion` is a genuinely newer semver than
 *  `installedVersion` (not merely "different" -- a downgraded/rolled-back
 *  registry entry is never offered as an "update"). Never throws: an
 *  unparsable version pair is treated as "no update" rather than crashing
 *  the Updates tab over one bad comparison. */
function isNewerVersion(registryVersion: string, installedVersion: string): boolean {
  try {
    return compareVersions(registryVersion, installedVersion) > 0;
  } catch {
    return false;
  }
}

function ScopePreview({ scopes }: { scopes: string[] }): React.ReactElement {
  if (scopes.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">Keine Berechtigungen angefragt.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1" data-testid="scope-preview">
      {scopes.map((scope) => (
        <li
          key={scope}
          className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[11px] text-slate-700 dark:text-slate-200"
          data-testid={`scope-badge-${scope}`}
        >
          {scope}
        </li>
      ))}
    </ul>
  );
}

/** Blocking notice shown INSTEAD OF an install/update button for a
 *  core_api-incompatible entry (acceptance criterion 2, W-11). */
function IncompatibleNotice({ entry }: { entry: RegistryEntryView }): React.ReactElement {
  return (
    <p
      className="text-xs rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-1"
      data-testid={`incompatible-notice-${entry.id}`}
    >
      Nicht kompatibel mit dieser Core-Version (benötigt core_api {entry.core_api}).
    </p>
  );
}

export default function StorePanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'catalog' | 'updates'>('catalog');
  const [catalog, setCatalog] = useState<RegistryCatalog>({
    entries: [],
    fetchedAt: null,
    ageMs: null,
    sourceUrl: '',
    errors: [],
  });
  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [installFlow, setInstallFlow] = useState<InstallFlowState>({ kind: 'idle' });
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // Mirrors RegionsPanel's `useUiStore`-driven open: some OTHER surface can
  // programmatically open this panel later (`useUiStore.openAddonStorePanel()`,
  // e.g. a future "no compatible add-on installed" notice elsewhere in the
  // app), the same way RoutingPanel opens RegionsPanel today.
  const addonStorePanelOpen = useUiStore((state) => state.addonStorePanel.isOpen);
  useEffect(() => {
    if (addonStorePanelOpen) setIsOpen(true);
  }, [addonStorePanelOpen]);

  const refresh = useCallback(async () => {
    const [freshCatalog, freshInstalled] = await Promise.all([fetchRegistryCatalog(), fetchAddons()]);
    setCatalog(freshCatalog);
    setInstalled(freshInstalled);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!isOpen || loaded) return;
    void refresh();
  }, [isOpen, loaded, refresh]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const fresh = await syncRegistry();
      setCatalog(fresh);
    } catch (err) {
      setSyncError(
        err instanceof StoreApiError
          ? `Registry nicht erreichbar (${err.message}).`
          : 'Registry nicht erreichbar.',
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  const installedIds = useMemo(() => new Set(installed.map((a) => a.id)), [installed]);
  const installedById = useMemo(() => new Map(installed.map((a) => [a.id, a])), [installed]);
  const catalogEntries = useMemo(
    () => catalog.entries.filter((e) => !installedIds.has(e.id)),
    [catalog.entries, installedIds],
  );
  const updateEntries = useMemo(
    () =>
      catalog.entries
        .map((entry) => ({ entry, installedAddon: installedById.get(entry.id) }))
        .filter(
          (row): row is { entry: RegistryEntryView; installedAddon: InstalledAddon } =>
            row.installedAddon !== undefined && isNewerVersion(row.entry.version, row.installedAddon.version),
        ),
    [catalog.entries, installedById],
  );
  const selectedEntry = useMemo(
    () => catalog.entries.find((e) => e.id === selectedEntryId) ?? null,
    [catalog.entries, selectedEntryId],
  );

  const runInstallFlow = useCallback(
    async (label: string, begin: () => Promise<PendingInstall>) => {
      setInstallFlow({ kind: 'beginning', label });
      try {
        const pending = await begin();
        setInstallFlow({ kind: 'confirming', label, pending });
      } catch (err) {
        setInstallFlow({
          kind: 'error',
          label,
          message: err instanceof StoreApiError ? err.message : 'Installation konnte nicht gestartet werden.',
        });
      }
    },
    [],
  );

  const handleInstallFromRegistry = useCallback(
    (entry: RegistryEntryView) => {
      void runInstallFlow(entry.name, () => beginInstallFromUrl(entry.download_url, entry.sha256));
    },
    [runInstallFlow],
  );

  const handleUploadSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-selecting the same file later
      if (!file) return;
      void runInstallFlow(file.name, async () => {
        const buffer = await file.arrayBuffer();
        return beginInstallFromUpload(arrayBufferToBase64(buffer));
      });
    },
    [runInstallFlow],
  );

  const handleConfirmInstall = useCallback(async () => {
    if (installFlow.kind !== 'confirming') return;
    const { label, pending } = installFlow;
    setInstallFlow({ kind: 'installing', label });
    try {
      await confirmPendingInstall(pending.pendingId);
      setInstallFlow({ kind: 'done', label });
      await refresh();
    } catch (err) {
      setInstallFlow({
        kind: 'error',
        label,
        message: err instanceof StoreApiError ? err.message : 'Installation fehlgeschlagen.',
      });
    }
  }, [installFlow, refresh]);

  const cancelInstallFlow = useCallback(() => setInstallFlow({ kind: 'idle' }), []);

  const handleToggleEnabled = useCallback(
    async (addon: InstalledAddon) => {
      setLifecycleError(null);
      try {
        if (addon.enabled) await disableAddon(addon.id);
        else await enableAddon(addon.id);
        await refresh();
      } catch (err) {
        setLifecycleError(err instanceof StoreApiError ? err.message : 'Aktion fehlgeschlagen.');
      }
    },
    [refresh],
  );

  const handleUninstall = useCallback(
    async (id: string) => {
      setLifecycleError(null);
      try {
        await uninstallAddonById(id);
        await refresh();
      } catch (err) {
        setLifecycleError(err instanceof StoreApiError ? err.message : 'Deinstallation fehlgeschlagen.');
      }
    },
    [refresh],
  );

  const toggleOpen = useCallback(() => setIsOpen((open) => !open), []);

  // W-13: the upload path is offered PROMINENTLY whenever the registry is
  // unreachable -- either the last sync attempt failed, or nothing has ever
  // been synced at all (a fresh/offline-since-day-one install).
  const registryUnreachable = syncError !== null || catalog.fetchedAt === null;

  // `top-36`: MapLibre's own NavigationControl claims the very top of this
  // corner (`top-0`..~`top-20`, see RegionsPanel's identical comment), and
  // RegionsPanel's own FAB already sits at `top-20` (spans to
  // `top-20 + 48px = 128px`) -- this is the NEXT free slot below both,
  // confirmed against gestures.spec.ts's zoom-in-button click (a `top-4`
  // placement here intercepted MapLibre's zoom control).
  return (
    <div className="fixed top-36 right-4 z-10">
      {isOpen && (
        <div
          className="absolute top-14 right-0 mb-2 w-96 max-h-[75vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4"
          data-testid="store-panel"
        >
          <DriveLockGate controlId="addon-store">
            {/* Cache status + sync (W-13) -- shown REGARDLESS of tab. */}
            <section className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span data-testid="store-cache-status" className="text-xs text-slate-500 dark:text-slate-400">
                  {formatCacheAge(catalog.ageMs)}
                </span>
                <button
                  onClick={() => void handleSync()}
                  disabled={syncing}
                  className="shrink-0 px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                  data-testid="store-sync-button"
                >
                  {syncing ? 'Synchronisiere…' : 'Registry aktualisieren'}
                </button>
              </div>
              {syncError && (
                <p className="text-xs text-red-600 dark:text-red-400" data-testid="store-sync-error">
                  {syncError}
                </p>
              )}
            </section>

            {/* Upload-install: always available, called out when offline. */}
            <section
              className={
                registryUnreachable
                  ? 'rounded-lg border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 p-2 space-y-1'
                  : 'rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1'
              }
              data-testid="store-upload-section"
            >
              <h3 className="font-semibold text-xs">
                {registryUnreachable ? 'Registry nicht erreichbar — per Datei installieren' : 'Add-on-Datei installieren'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add-on-Paket (.tar.gz) von USB-Stick oder Download installieren — funktioniert immer, auch ohne
                Internet.
              </p>
              <input
                type="file"
                accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
                onChange={handleUploadSelected}
                className="text-xs"
                data-testid="store-upload-input"
              />
            </section>

            {selectedEntry ? (
              <section data-testid="store-detail-view" className="space-y-2">
                <button
                  onClick={() => setSelectedEntryId(null)}
                  className="text-xs text-blue-600 dark:text-blue-400"
                  data-testid="store-detail-back"
                >
                  ← Zurück zum Katalog
                </button>
                <div className="flex items-center gap-2">
                  {selectedEntry.icon && (
                    <img src={selectedEntry.icon} alt="" className="w-10 h-10 rounded" />
                  )}
                  <div>
                    <div className="font-semibold" data-testid="store-detail-name">
                      {selectedEntry.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Version {selectedEntry.version} · core_api {selectedEntry.core_api}
                    </div>
                  </div>
                </div>
                <p className="text-xs" data-testid="store-detail-description">
                  {selectedEntry.description}
                </p>
                <div>
                  <h4 className="text-xs font-semibold mb-1">Angefragte Berechtigungen</h4>
                  <ScopePreview scopes={selectedEntry.scopes} />
                </div>
                {selectedEntry.screenshots.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto" data-testid="store-detail-screenshots">
                    {selectedEntry.screenshots.map((src) => (
                      <img key={src} src={src} alt="" className="h-20 rounded border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                )}
                {selectedEntry.compatible ? (
                  <button
                    onClick={() => handleInstallFromRegistry(selectedEntry)}
                    className="w-full px-2 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
                    data-testid={`install-button-${selectedEntry.id}`}
                  >
                    Installieren
                  </button>
                ) : (
                  <IncompatibleNotice entry={selectedEntry} />
                )}
              </section>
            ) : (
              <>
                <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === 'catalog'}
                    onClick={() => setTab('catalog')}
                    className={`px-2 py-1 text-xs font-semibold ${tab === 'catalog' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                    data-testid="store-tab-catalog"
                  >
                    Katalog
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'updates'}
                    onClick={() => setTab('updates')}
                    className={`px-2 py-1 text-xs font-semibold ${tab === 'updates' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                    data-testid="store-tab-updates"
                  >
                    Updates{updateEntries.length > 0 ? ` (${updateEntries.length})` : ''}
                  </button>
                </nav>

                {tab === 'catalog' && (
                  <section className="space-y-2" data-testid="store-catalog">
                    {loaded && catalogEntries.length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="store-catalog-empty">
                        Keine Add-ons im Katalog verfügbar.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {catalogEntries.map((entry) => (
                        <li
                          key={entry.id}
                          className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1"
                          data-testid={`catalog-entry-${entry.id}`}
                        >
                          <button
                            className="flex items-start gap-2 w-full text-left"
                            onClick={() => setSelectedEntryId(entry.id)}
                            data-testid={`catalog-entry-open-${entry.id}`}
                          >
                            {entry.icon && <img src={entry.icon} alt="" className="w-8 h-8 rounded shrink-0" />}
                            <span>
                              <span className="font-medium block">{entry.name}</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                                v{entry.version} · {entry.description}
                              </span>
                            </span>
                          </button>
                          <ScopePreview scopes={entry.scopes} />
                          {entry.compatible ? (
                            <button
                              onClick={() => handleInstallFromRegistry(entry)}
                              className="px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30"
                              data-testid={`install-button-${entry.id}`}
                            >
                              Installieren
                            </button>
                          ) : (
                            <IncompatibleNotice entry={entry} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {tab === 'updates' && (
                  <section className="space-y-2" data-testid="store-updates">
                    {lifecycleError && (
                      <p className="text-xs text-red-600 dark:text-red-400" data-testid="store-lifecycle-error">
                        {lifecycleError}
                      </p>
                    )}
                    {loaded && updateEntries.length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="updates-empty">
                        Alle installierten Add-ons sind aktuell.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {updateEntries.map(({ entry, installedAddon }) => (
                        <li
                          key={entry.id}
                          className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1"
                          data-testid={`update-entry-${entry.id}`}
                        >
                          <div className="font-medium">{entry.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            installiert {installedAddon.version} → verfügbar {entry.version}
                          </div>
                          {entry.compatible ? (
                            <button
                              onClick={() => handleInstallFromRegistry(entry)}
                              className="px-2 py-1 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30"
                              data-testid={`update-button-${entry.id}`}
                            >
                              Update installieren
                            </button>
                          ) : (
                            <IncompatibleNotice entry={entry} />
                          )}
                        </li>
                      ))}
                    </ul>

                    {installed.length > 0 && (
                      <div>
                        <h3 className="font-semibold text-xs mb-1">Installierte Add-ons</h3>
                        <ul className="space-y-2">
                          {installed.map((addon) => (
                            <li
                              key={addon.id}
                              className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2"
                              data-testid={`installed-addon-${addon.id}`}
                            >
                              <span>
                                <span className="font-medium block">{addon.name}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  v{addon.version} · {addon.enabled ? 'aktiv' : 'deaktiviert'}
                                </span>
                              </span>
                              <span className="flex gap-1 shrink-0">
                                <button
                                  onClick={() => void handleToggleEnabled(addon)}
                                  className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs"
                                  data-testid={`toggle-enabled-${addon.id}`}
                                >
                                  {addon.enabled ? 'Deaktivieren' : 'Aktivieren'}
                                </button>
                                <button
                                  onClick={() => void handleUninstall(addon.id)}
                                  className="px-2 py-1 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs"
                                  data-testid={`uninstall-button-${addon.id}`}
                                >
                                  Deinstallieren
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            {/* Install flow: begin -> scope-confirm -> job progress. */}
            {installFlow.kind !== 'idle' && (
              <section
                className="rounded-lg border border-slate-300 dark:border-slate-600 p-2 space-y-2"
                data-testid="install-flow"
              >
                {installFlow.kind === 'beginning' && (
                  <p className="text-xs" data-testid="install-progress">
                    Prüfe „{installFlow.label}"…
                  </p>
                )}
                {installFlow.kind === 'confirming' && (
                  <div className="space-y-2" data-testid="scope-confirm-dialog">
                    <p className="text-xs font-semibold">
                      {installFlow.pending.isUpdate ? 'Update bestätigen' : 'Installation bestätigen'}: {installFlow.pending.manifest.name} v{installFlow.pending.manifest.version}
                    </p>
                    <ScopePreview scopes={installFlow.pending.permissions} />
                    {installFlow.pending.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-xs rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-2 py-1"
                        data-testid="scope-confirm-warning"
                      >
                        {warning}
                      </p>
                    ))}
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleConfirmInstall()}
                        className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
                        data-testid="scope-confirm-confirm-button"
                      >
                        Bestätigen &amp; installieren
                      </button>
                      <button
                        onClick={cancelInstallFlow}
                        className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs"
                        data-testid="scope-confirm-cancel-button"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
                {installFlow.kind === 'installing' && (
                  <p className="text-xs" data-testid="install-progress">
                    Installiere „{installFlow.label}"…
                  </p>
                )}
                {installFlow.kind === 'done' && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-green-700 dark:text-green-400" data-testid="install-success">
                      „{installFlow.label}" installiert.
                    </p>
                    <button
                      onClick={cancelInstallFlow}
                      className="text-xs text-slate-500 dark:text-slate-400"
                      data-testid="install-flow-dismiss"
                    >
                      Schließen
                    </button>
                  </div>
                )}
                {installFlow.kind === 'error' && (
                  <div className="space-y-1">
                    <p className="text-xs text-red-600 dark:text-red-400" data-testid="install-error">
                      {installFlow.message}
                    </p>
                    <button
                      onClick={cancelInstallFlow}
                      className="text-xs text-slate-500 dark:text-slate-400"
                      data-testid="install-flow-dismiss"
                    >
                      Schließen
                    </button>
                  </div>
                )}
              </section>
            )}
          </DriveLockGate>
        </div>
      )}

      <button
        onClick={toggleOpen}
        className="w-12 h-12 rounded-full bg-white/90 dark:bg-slate-800/90 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg"
        aria-label="Add-on-Store"
        aria-expanded={isOpen}
        title="Add-on-Store"
        data-testid="store-panel-toggle"
      >
        🧩
      </button>
    </div>
  );
}
