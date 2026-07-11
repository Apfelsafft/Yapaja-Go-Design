/**
 * E06-T2 web acceptance criteria (profiles UI):
 *
 * End-to-end test of the profile editor flow:
 * - Create a new profile via the UI
 * - Enter invalid values → field errors appear
 * - Correct the values
 * - Save the profile
 * - Activate it (chip updates immediately)
 * - Delete a profile
 * - Disclaimer shows for height > 2.7
 *
 * Uses the real Core (built, with in-memory DB) to test the full round-trip.
 * No foreign network requests should occur (offline-first).
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('complete profile editor flow: create, validate, correct, save, activate, delete', async ({
  page,
}) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // 1. Open profiles panel by clicking the chip
  await page.getByTestId('profile-chip').click();
  await expect(page.getByTestId('profiles-panel')).toBeVisible();

  // 2. Click "Neues Profil" to open editor
  await page.getByTestId('create-profile-button').click();
  await expect(page.locator('h2')).toContainText('Neues Profil');

  // 3. Try to save with empty name → should show error
  const nameInput = page.getByTestId('profile-name-input');
  await nameInput.fill('');
  await page.getByTestId('save-button').click();
  const nameError = page.getByTestId('name-error');
  await expect(nameError).toBeVisible();
  await expect(nameError).toContainText('nicht leer');

  // 4. Enter a name
  await nameInput.fill('Test Kastenwagen');

  // 5. Enter height as 6.5 m (beyond max 4.5) → should show error
  const heightNumber = page.getByTestId('height-input-number');

  // Use the number input to enter out-of-range value
  await heightNumber.clear();
  await heightNumber.fill('6.5');
  await page.getByTestId('save-button').click();

  // Should see field error for height
  const heightError = page.getByTestId('height-input-error');
  await expect(heightError).toBeVisible();
  await expect(heightError).toContainText('muss zwischen');

  // 6. Correct the height to 2.5 m
  await heightNumber.clear();
  await heightNumber.fill('2.5');

  // Also set other dimensions for a valid profile
  await page.getByTestId('width-input-number').clear();
  await page.getByTestId('width-input-number').fill('2.0');
  await page.getByTestId('length-input-number').clear();
  await page.getByTestId('length-input-number').fill('6.0');
  await page.getByTestId('weight-input-number').clear();
  await page.getByTestId('weight-input-number').fill('3.0');
  await page.getByTestId('speed-input-number').clear();
  await page.getByTestId('speed-input-number').fill('80');

  // 7. Live silhouette should be visible and update as we change dimensions
  const silhouette = page.getByTestId('vehicle-silhouette');
  await expect(silhouette).toBeVisible();

  // 8. Save the profile (no disclaimer since height is 2.5)
  await page.getByTestId('save-button').click();

  // Should return to panel
  await expect(page.getByTestId('profiles-panel')).toBeVisible();

  // New profile should appear in the list - look for the one that contains the name
  const newProfileItem = page.locator('[data-testid^="profile-item-"]').filter({ hasText: 'Test Kastenwagen' });
  await expect(newProfileItem).toBeVisible();

  // 9. Activate the profile (click on it)
  await newProfileItem.click();

  // Chip should update immediately to show new profile name
  const chipName = page.getByTestId('profile-chip-name');
  await expect(chipName).toContainText('Test Kastenwagen');

  // Panel should still be visible after activation
  await page.waitForTimeout(100); // Small delay to allow re-render
  await expect(page.getByTestId('profiles-panel')).toBeVisible();

  // 10. Verify the profile is marked as active
  const activeProfile = page.locator('[data-testid^="profile-item-"]').filter({ hasText: 'Test Kastenwagen' });
  await expect(activeProfile).toContainText('Aktiv');

  // 11. Edit the profile
  const editButton = activeProfile.locator('[data-testid^="edit-button-"]').first();
  await editButton.click();

  // Change the name
  const editNameInput = page.getByTestId('profile-name-input');
  await editNameInput.clear();
  await editNameInput.fill('Updated Kastenwagen');

  // Save
  await page.getByTestId('save-button').click();

  // Back to panel, new name should appear
  await expect(page.getByTestId('profiles-panel')).toBeVisible();
  const updatedProfileItem = page.locator('[data-testid^="profile-item-"]').filter({ hasText: 'Updated Kastenwagen' });
  await expect(updatedProfileItem).toBeVisible();

  // 12. We can't delete the active profile, so first create another profile and activate it,
  // then delete the first one
  await page.getByTestId('create-profile-button').click();
  await page.getByTestId('profile-name-input').fill('Second Profile');
  await page.getByTestId('width-input-number').clear();
  await page.getByTestId('width-input-number').fill('2.0');
  await page.getByTestId('length-input-number').clear();
  await page.getByTestId('length-input-number').fill('5.0');
  await page.getByTestId('weight-input-number').clear();
  await page.getByTestId('weight-input-number').fill('2.0');
  await page.getByTestId('speed-input-number').clear();
  await page.getByTestId('speed-input-number').fill('80');
  await page.getByTestId('save-button').click();

  // Wait for it to appear and activate it
  const secondProfileItem = page.locator('[data-testid^="profile-item-"]').filter({ hasText: 'Second Profile' });
  await expect(secondProfileItem).toBeVisible();
  await secondProfileItem.click();

  // Now delete the first profile
  await expect(updatedProfileItem).toBeVisible(); // It should still be there but inactive
  const deleteButton = updatedProfileItem.locator('[data-testid^="delete-button-"]').first();
  await deleteButton.click();

  // Profile should be gone from the list
  await expect(updatedProfileItem).not.toBeVisible();

  // 13. Verify no foreign network requests
  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('height disclaimer shows when height_m > 2.7', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Open panel and create new profile
  await page.getByTestId('profile-chip').click();
  await page.getByTestId('create-profile-button').click();

  // Set up a valid profile with name and base dimensions
  await page.getByTestId('profile-name-input').fill('Tall Motorhome');
  await page.getByTestId('width-input-number').clear();
  await page.getByTestId('width-input-number').fill('2.0');
  await page.getByTestId('length-input-number').clear();
  await page.getByTestId('length-input-number').fill('6.0');
  await page.getByTestId('weight-input-number').clear();
  await page.getByTestId('weight-input-number').fill('3.0');
  await page.getByTestId('speed-input-number').clear();
  await page.getByTestId('speed-input-number').fill('80');

  // Set height to exactly 2.8 m (> 2.7, triggers disclaimer)
  await page.getByTestId('height-input-number').clear();
  await page.getByTestId('height-input-number').fill('2.8');

  // Try to save
  await page.getByTestId('save-button').click();

  // Disclaimer dialog should appear
  const disclaimerDialog = page.getByTestId('height-disclaimer-dialog');
  await expect(disclaimerDialog).toBeVisible();
  await expect(disclaimerDialog).toContainText('Höhenwarnung');
  await expect(disclaimerDialog).toContainText('2,7 m');
  await expect(disclaimerDialog).toContainText('OpenStreetMap');

  // Clicking "Zurück bearbeiten" should dismiss the dialog
  await page.getByTestId('disclaimer-cancel-button').click();
  await expect(disclaimerDialog).not.toBeVisible();

  // Editor should still be open
  await expect(page.locator('h2')).toContainText('Neues Profil');

  // Try again to save, and this time confirm
  await page.getByTestId('save-button').click();
  await expect(disclaimerDialog).toBeVisible();

  await page.getByTestId('disclaimer-confirm-button').click();

  // Profile should be saved and we return to panel
  await expect(page.getByTestId('profiles-panel')).toBeVisible();
  const tallProfileItem = page.locator('[data-testid^="profile-item-"]').filter({ hasText: 'Tall Motorhome' });
  await expect(tallProfileItem).toBeVisible();

  // Verify no foreign network requests
  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('suspicious profile warning appears for height < 1.8 m AND weight > 3.0 t', async ({
  page,
}) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Open panel and create new profile
  await page.getByTestId('profile-chip').click();
  await page.getByTestId('create-profile-button').click();

  // Set suspicious values: height 1.7 m, weight 3.1 t
  await page.getByTestId('profile-name-input').fill('Car Profile');
  await page.getByTestId('height-input-number').clear();
  await page.getByTestId('height-input-number').fill('1.7');
  await page.getByTestId('width-input-number').clear();
  await page.getByTestId('width-input-number').fill('1.8');
  await page.getByTestId('length-input-number').clear();
  await page.getByTestId('length-input-number').fill('4.5');
  await page.getByTestId('weight-input-number').clear();
  await page.getByTestId('weight-input-number').fill('3.1');
  await page.getByTestId('speed-input-number').clear();
  await page.getByTestId('speed-input-number').fill('80');

  // Suspicious warning should appear
  const warning = page.getByTestId('suspicious-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Ungewöhnliche Kombination');

  // We can still save (it's not a blocker)
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('profiles-panel')).toBeVisible();

  // Verify no foreign network requests
  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
