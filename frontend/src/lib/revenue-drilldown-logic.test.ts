import { describe, expect, it } from '@jest/globals';
import { ApiError } from './api-client';
import { describeDrilldownError } from './revenue-drilldown-logic';

/**
 * QA5B-OBS-2 regression: a malformed content id and a genuine server fault
 * must not read the same. The backend returns 400 (ParseUUIDPipe) for a
 * non-UUID and 404 for a well-formed id that matches nothing.
 */
describe('describeDrilldownError', () => {
  it('tells the admin the id itself is malformed on a 400', () => {
    expect(describeDrilldownError(new ApiError('Validation failed (uuid is expected)', 400))).toBe(
      'That content id is not valid.',
    );
  });

  it('distinguishes a well-formed id that matches nothing (404)', () => {
    expect(describeDrilldownError(new ApiError('Content not found', 404))).toBe(
      'That content does not exist.',
    );
  });

  it('falls back to a generic message for an unexpected server fault', () => {
    expect(describeDrilldownError(new ApiError('Internal server error', 500))).toBe(
      'Failed to load the revenue drill-down.',
    );
  });

  it('falls back for a non-ApiError (network failure, thrown string, …)', () => {
    expect(describeDrilldownError(new TypeError('fetch failed'))).toBe(
      'Failed to load the revenue drill-down.',
    );
  });
});
