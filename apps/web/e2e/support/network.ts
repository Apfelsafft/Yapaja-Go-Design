/**
 * Offline-first network assertions (E01-T2 acceptance criteria #1 and #3):
 * hard-block any request that isn't same-origin with the page, and record
 * every request URL the page issued so tests can assert on it.
 */

import type { Page } from '@playwright/test';

export interface RequestTracker {
  /** All request URLs observed (same-origin ones that were allowed through). */
  getAllUrls: () => string[];
  /** Request URLs that were blocked because they targeted a foreign origin. */
  getForeignUrls: () => string[];
}

/**
 * Installs a route handler that aborts any request whose origin differs
 * from `allowedOrigin` and records every request URL seen. Must be called
 * before `page.goto(...)`.
 */
export async function trackRequests(page: Page, allowedOrigin: string): Promise<RequestTracker> {
  const allUrls: string[] = [];
  const foreignUrls: string[] = [];

  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    allUrls.push(requestUrl);

    let origin: string;
    try {
      origin = new URL(requestUrl).origin;
    } catch {
      await route.continue();
      return;
    }

    if (origin !== allowedOrigin) {
      foreignUrls.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  return {
    getAllUrls: () => allUrls,
    getForeignUrls: () => foreignUrls,
  };
}

/** Collects uncaught page errors (proof of "no crash") for later assertion. */
export function collectPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => {
    errors.push(error);
  });
  return errors;
}
