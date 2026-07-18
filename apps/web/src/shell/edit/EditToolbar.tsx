/**
 * Edit-mode toolbar (E07-T2 acceptance criteria 3/1): the explicit
 * Save/Cancel controls plus "Reset to default" (behind a confirmation
 * dialog, task requirement). Purely presentational -- `Shell.tsx` owns all
 * the actual draft-mutation logic (`editModel.ts`); this component only
 * calls the callbacks it's given.
 */

import React from 'react';

export interface EditToolbarProps {
  onSave: () => void;
  onCancel: () => void;
  onRequestReset: () => void;
}

export function EditToolbar({ onSave, onCancel, onRequestReset }: EditToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="edit-toolbar"
      className="fixed top-2 right-2 z-50 flex gap-2 rounded-lg bg-slate-900/95 p-2 shadow-lg"
    >
      <button
        type="button"
        data-testid="edit-reset-button"
        aria-label="Auf Standard zurücksetzen"
        title="Auf Standard zurücksetzen"
        onClick={onRequestReset}
        className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600"
      >
        ↺
      </button>
      <button
        type="button"
        data-testid="edit-cancel-button"
        aria-label="Bearbeiten abbrechen"
        title="Abbrechen (verwirft alle Änderungen)"
        onClick={onCancel}
        className="rounded bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600"
      >
        ✕
      </button>
      <button
        type="button"
        data-testid="edit-save-button"
        aria-label="Layout speichern"
        title="Speichern"
        onClick={onSave}
        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        ✓
      </button>
    </div>
  );
}

export interface ResetConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/** Custom in-DOM confirmation (deliberately NOT `window.confirm`, which is
 *  unstyleable, blocks the whole page, and Playwright can only drive via a
 *  separate `page.on('dialog', ...)` side-channel rather than ordinary
 *  `getByTestId` assertions like every other flow in this app's e2e suite). */
export function ResetConfirmDialog({ onConfirm, onCancel }: ResetConfirmDialogProps): React.ReactElement {
  return (
    <div
      data-testid="edit-reset-confirm"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
    >
      <div className="max-w-xs rounded-lg bg-slate-900 p-4 text-slate-100 shadow-xl">
        <p className="mb-3 text-sm">Layout auf Standard zurücksetzen? Alle Änderungen an diesem Layout gehen verloren.</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="edit-reset-confirm-cancel"
            onClick={onCancel}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="edit-reset-confirm-yes"
            onClick={onConfirm}
            className="rounded bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-500"
          >
            Zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}
