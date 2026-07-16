import { ContentPillar } from '@prisma/client';
import { CopyrightGateService } from './copyright-gate.service';

describe('CopyrightGateService', () => {
  let service: CopyrightGateService;

  beforeEach(() => {
    service = new CopyrightGateService();
  });

  it('allows comedy content with no evidence', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.comedy,
        copyrightEvidenceUrl: null,
      }),
    ).toBe(true);
  });

  it('allows drama content that has evidence', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.drama,
        copyrightEvidenceUrl: 'https://evidence.example.com/license-123.pdf',
      }),
    ).toBe(true);
  });

  it('blocks drama content with no evidence', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.drama,
        copyrightEvidenceUrl: null,
      }),
    ).toBe(false);
  });

  it('blocks product content with no evidence', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.product,
        copyrightEvidenceUrl: null,
      }),
    ).toBe(false);
  });

  it('allows product content that has evidence', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.product,
        copyrightEvidenceUrl: 'https://evidence.example.com/brand-license-456.pdf',
      }),
    ).toBe(true);
  });

  it('blocks product content whose evidence url is an empty string', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.product,
        copyrightEvidenceUrl: '',
      }),
    ).toBe(false);
  });

  it('blocks drama content whose evidence url is whitespace only', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: ContentPillar.drama,
        copyrightEvidenceUrl: '   ',
      }),
    ).toBe(false);
  });

  it('fails closed (blocks) for unclassified content with no pillar, even with evidence absent', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: null,
        copyrightEvidenceUrl: null,
      }),
    ).toBe(false);
  });

  it('fails closed but still honors evidence for unclassified content with no pillar', () => {
    expect(
      service.canMarkCopyrightCleared({
        contentPillar: null,
        copyrightEvidenceUrl: 'https://evidence.example.com/pending-classification.pdf',
      }),
    ).toBe(true);
  });
});
