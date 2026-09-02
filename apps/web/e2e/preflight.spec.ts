/**
 * Installationsprüfung in der Oberfläche (`feat/gui-install-path`).
 *
 * Der Nachweis, auf den es ankommt: jemand, der das Add-on über die
 * Home-Assistant-Oberfläche installiert hat und KEINE Shell öffnen will,
 * muss in der App selbst sehen können, was seiner Installation fehlt — und
 * zwar auch dann, wenn noch keine Karte da ist, denn genau dann braucht er
 * es. Diese Spec läuft deshalb gegen den LEEREN Core (keine Kacheln), also
 * gegen denselben Zustand, in dem ein frisch installiertes Add-on startet.
 */

import { test, expect } from '@playwright/test';
import { EMPTY_CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('zeigt ohne Karte die Installationsprüfung mit echten Befunden und Handlungsanweisungen', async ({
  page,
}) => {
  const tracker = await trackRequests(page, EMPTY_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });

  // Die Prüfung darf NICHT von allein beim Seitenaufbau laufen -- sie
  // öffnet serverseitig TCP-Verbindungen und ist dafür zu teuer.
  await expect(page.getByTestId('preflight-panel')).toHaveCount(0);

  await page.getByTestId('preflight-panel-toggle').click();
  await expect(page.getByTestId('preflight-panel')).toBeVisible();

  const summary = page.getByTestId('preflight-summary');
  await expect(summary).toBeVisible({ timeout: 20_000 });

  // Der Kern: dieser Core hat KEINE Kacheln. Das muss als Pflichtmangel
  // erscheinen -- nicht als Warnung und erst recht nicht als „ok".
  const tiles = page.getByTestId('preflight-check-tiles');
  await expect(tiles).toBeVisible();
  await expect(tiles).toHaveAttribute('data-status', 'fail');
  await expect(summary).toHaveAttribute('data-status', 'fail');

  // Und der eigentliche Zweck der Seite: zu jedem Mangel steht da, was zu
  // tun ist. Ein Befund ohne Anweisung nützt dem Adressaten nichts.
  //
  // Hier stand `toContainText('Kartenregionen')`. Dieses Wort stammte aus dem
  // Menüpfad „Einstellungen → Kartenregionen" -- den es nie gab. Der Test hat
  // damit ausgerechnet die erfundene Formulierung festgeschrieben und wäre
  // rot geworden, sobald jemand sie korrigiert. Geprüft wird jetzt das, was
  // die Anweisung BRAUCHBAR macht: der Befehl, den der Betreiber wirklich
  // eintippen kann.
  await expect(page.getByTestId('preflight-remedy-tiles')).toContainText(
    'yapaja-build-pmtiles',
  );

  // Alle sieben Prüfungen sind da, jede mit einem echten Status.
  await expect(page.locator('[data-testid^="preflight-check-"]')).toHaveCount(7);

  await expect(page.getByTestId('preflight-checked-at')).toBeVisible();

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('prüft auf Knopfdruck erneut', async ({ page }) => {
  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await page.getByTestId('preflight-panel-toggle').click();
  await expect(page.getByTestId('preflight-summary')).toBeVisible({ timeout: 20_000 });

  const first = await page.getByTestId('preflight-checked-at').textContent();

  const rerun = page.waitForResponse(
    (res) => res.url().includes('/api/v1/system/preflight') && res.status() === 200,
  );
  await page.getByTestId('preflight-rerun').click();
  await rerun;

  // Der Zeitstempel stammt vom Server; nach einem zweiten Lauf muss ein
  // Ergebnis dastehen (dass es dasselbe SEIN darf, ist erlaubt -- die
  // Installation hat sich ja nicht geändert; dass die Seite überhaupt neu
  // lädt, ist die Aussage).
  await expect(page.getByTestId('preflight-checked-at')).toBeVisible();
  expect(first).toBeTruthy();
});
