import { describe, expect, it } from '@jest/globals';
import {
  canMarkCleared,
  canMarkReady,
  hasRequiredEvidence,
  readyBlockers,
  type CopyrightGateState,
} from '@/lib/copyright-gate';

function state(overrides: Partial<CopyrightGateState> = {}): CopyrightGateState {
  return {
    copyrightCleared: 'not_checked',
    contentPillar: null,
    copyrightEvidenceUrl: '',
    ...overrides,
  };
}

describe('hasRequiredEvidence', () => {
  it('exempts the comedy pillar without evidence', () => {
    expect(hasRequiredEvidence('comedy', '')).toBe(true);
  });

  it('requires non-empty evidence for drama and product', () => {
    expect(hasRequiredEvidence('drama', '')).toBe(false);
    expect(hasRequiredEvidence('product', '   ')).toBe(false);
    expect(hasRequiredEvidence('drama', '/uploads/proof.pdf')).toBe(true);
  });

  it('fails closed for an unclassified (null) pillar', () => {
    expect(hasRequiredEvidence(null, '')).toBe(false);
    expect(hasRequiredEvidence(null, '/uploads/proof.pdf')).toBe(true);
  });
});

describe('canMarkReady', () => {
  it('is disabled until clearance is "cleared"', () => {
    expect(canMarkReady(state({ contentPillar: 'comedy', copyrightCleared: 'not_checked' }))).toBe(
      false,
    );
    expect(canMarkReady(state({ contentPillar: 'comedy', copyrightCleared: 'blocked' }))).toBe(
      false,
    );
  });

  it('enables a cleared comedy item with no evidence', () => {
    expect(canMarkReady(state({ contentPillar: 'comedy', copyrightCleared: 'cleared' }))).toBe(true);
  });

  it('keeps drama disabled when cleared but missing evidence', () => {
    expect(canMarkReady(state({ contentPillar: 'drama', copyrightCleared: 'cleared' }))).toBe(false);
  });

  it('enables a cleared drama item once evidence is present', () => {
    expect(
      canMarkReady(
        state({
          contentPillar: 'drama',
          copyrightCleared: 'cleared',
          copyrightEvidenceUrl: '/uploads/license.pdf',
        }),
      ),
    ).toBe(true);
  });

  it('fails closed for a cleared unclassified item without evidence', () => {
    expect(canMarkReady(state({ contentPillar: null, copyrightCleared: 'cleared' }))).toBe(false);
  });
});

describe('canMarkCleared', () => {
  it('mirrors the pillar evidence rule independent of the clearance flag', () => {
    expect(canMarkCleared(state({ contentPillar: 'comedy' }))).toBe(true);
    expect(canMarkCleared(state({ contentPillar: 'product' }))).toBe(false);
  });
});

describe('readyBlockers', () => {
  it('reports no blockers when the gate is satisfied', () => {
    expect(
      readyBlockers(state({ contentPillar: 'comedy', copyrightCleared: 'cleared' })),
    ).toHaveLength(0);
  });

  it('reports both blockers for an uncleared drama item without evidence', () => {
    const blockers = readyBlockers(state({ contentPillar: 'drama' }));
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain('Cleared');
    expect(blockers[1]).toContain('drama');
  });

  it('names unclassified content in the evidence blocker', () => {
    const blockers = readyBlockers(state({ contentPillar: null, copyrightCleared: 'cleared' }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('unclassified');
  });
});
