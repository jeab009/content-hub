import type { ContentPillar, CopyrightClearance } from '@/lib/api-client';

/**
 * Client-side mirror of the backend copyright ready-gate
 * (backend CopyrightGateService + ContentService.assertReadyTransitionAllowed).
 *
 * A piece of content may be marked `ready` only when BOTH hold:
 *  1. `copyrightCleared === 'cleared'`, AND
 *  2. the pillar-based evidence rule passes: `comedy` is exempt; every other
 *     pillar — and unclassified content (null pillar) — requires a non-empty
 *     `copyrightEvidenceUrl` (fail closed).
 *
 * This is a legal-risk control, so the UI prevents the obviously-invalid
 * submit and shows exactly what is missing. The backend is still the source of
 * truth (returns 400) — the UI surfaces that too if it slips through.
 */
export interface CopyrightGateState {
  copyrightCleared: CopyrightClearance;
  contentPillar: ContentPillar | null;
  copyrightEvidenceUrl: string;
}

/** True when the pillar's evidence requirement is satisfied. */
export function hasRequiredEvidence(
  contentPillar: ContentPillar | null,
  copyrightEvidenceUrl: string,
): boolean {
  if (contentPillar === 'comedy') {
    return true;
  }
  return copyrightEvidenceUrl.trim().length > 0;
}

/** True when the content is eligible to be set `copyrightCleared = 'cleared'`. */
export function canMarkCleared(state: CopyrightGateState): boolean {
  return hasRequiredEvidence(state.contentPillar, state.copyrightEvidenceUrl);
}

/** True when the "Mark Ready" control should be enabled. */
export function canMarkReady(state: CopyrightGateState): boolean {
  return state.copyrightCleared === 'cleared' && canMarkCleared(state);
}

/**
 * Human-readable list of what still blocks "Mark Ready". Empty when the gate
 * is satisfied. Used for the inline helper text next to the disabled button.
 */
export function readyBlockers(state: CopyrightGateState): string[] {
  const blockers: string[] = [];
  if (state.copyrightCleared !== 'cleared') {
    blockers.push('Copyright clearance must be set to "Cleared".');
  }
  if (!hasRequiredEvidence(state.contentPillar, state.copyrightEvidenceUrl)) {
    const pillar = state.contentPillar ?? 'unclassified (no pillar assigned)';
    blockers.push(
      `A copyright evidence link is required for ${pillar} content ` +
        '(only the comedy pillar is exempt).',
    );
  }
  return blockers;
}
