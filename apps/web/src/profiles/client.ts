/**
 * Fetch helpers for profile management (E06-T2): list profiles, create, update,
 * delete, and activate profiles.
 *
 * Like `apps/web/src/settings/regions/client.ts`, every URL is built from
 * `import.meta.env.BASE_URL` so this keeps working under an ingress sub-path.
 */

import type { VehicleProfile } from '@yapaja/shared';

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Thrown by mutating calls (create/update/delete/activate), carrying
 *  the core's unified error shape so callers can handle specific codes. */
export class ProfileApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ProfileApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<ProfileApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new ProfileApiError(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new ProfileApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

/** List all profiles. Returns [] (never throws) on network/parse failure. */
export async function fetchProfiles(): Promise<VehicleProfile[]> {
  try {
    const response = await fetch(apiUrl('api/v1/profiles'));
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data: VehicleProfile[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** Get a single profile by ID. Returns null (never throws) on network/parse failure. */
export async function fetchProfile(id: string): Promise<VehicleProfile | null> {
  try {
    const response = await fetch(apiUrl(`api/v1/profiles/${encodeURIComponent(id)}`));
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { data: VehicleProfile };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** Create a new profile. Throws ProfileApiError on any non-2xx response. */
export async function createProfile(
  data: Omit<VehicleProfile, 'id' | 'is_active'>,
): Promise<VehicleProfile> {
  const response = await fetch(apiUrl('api/v1/profiles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { data: VehicleProfile };
  return body.data;
}

/** Update an existing profile. Throws ProfileApiError on any non-2xx response. */
export async function updateProfile(
  id: string,
  data: Partial<VehicleProfile>,
): Promise<VehicleProfile> {
  const response = await fetch(apiUrl(`api/v1/profiles/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { data: VehicleProfile };
  return body.data;
}

/** Delete a profile. Throws ProfileApiError on any non-2xx response
 * (e.g. 409 ACTIVE_PROFILE_UNDELETABLE). */
export async function deleteProfile(id: string): Promise<void> {
  const response = await fetch(apiUrl(`api/v1/profiles/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
}

/** Activate a profile (set is_active=true). Throws ProfileApiError on any
 *  non-2xx response. */
export async function activateProfile(id: string): Promise<VehicleProfile> {
  const response = await fetch(apiUrl(`api/v1/profiles/${encodeURIComponent(id)}/activate`), {
    method: 'PUT',
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { data: VehicleProfile };
  return body.data;
}

/** „Die Masse stimmen so" -- bestaetigt die Abmessungen des Profils, ohne
 *  etwas zu aendern. Siehe `UnconfirmedDimensionsBanner`. */
export async function confirmProfileDimensions(id: string): Promise<VehicleProfile> {
  const response = await fetch(
    apiUrl(`api/v1/profiles/${encodeURIComponent(id)}/confirm_dimensions`),
    { method: 'PUT' },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { data: VehicleProfile };
  return body.data;
}
