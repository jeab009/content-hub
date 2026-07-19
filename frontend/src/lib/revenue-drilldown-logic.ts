import { ApiError } from './api-client';

/**
 * QA5B-OBS-2: the revenue drill-down used to collapse every non-401 failure
 * into a single "Failed to load", so a malformed id and a real server fault
 * read identically to the admin.
 *
 * The backend deliberately keeps returning 400 for a non-UUID — that is a
 * malformed request, not a missing resource, and every UUID route in the API
 * answers the same way — so the distinction belongs here on the client.
 */
export function describeDrilldownError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Failed to load the revenue drill-down.';
  }
  // 400 = the id in the URL isn't a UUID at all (ParseUUIDPipe rejected it).
  if (err.status === 400) {
    return 'That content id is not valid.';
  }
  if (err.status === 404) {
    return 'That content does not exist.';
  }
  return 'Failed to load the revenue drill-down.';
}
