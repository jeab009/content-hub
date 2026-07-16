import { Injectable } from '@nestjs/common';
import { ContentPillar } from '@prisma/client';

/**
 * Minimal shape needed to evaluate the copyright gate. Callers may pass a
 * full Prisma `Content` record (both fields exist on it) or any object
 * exposing just these two — this service does not depend on Prisma's
 * `Content` type so it stays trivially unit-testable.
 */
export interface CopyrightGateInput {
  contentPillar: ContentPillar | null;
  copyrightEvidenceUrl: string | null;
}

/**
 * Phase 1.5 — System Analyst Condition #3.
 *
 * Pure validation service: decides whether a piece of content is *eligible*
 * to be marked `copyrightCleared = cleared`. It does not read or write
 * `copyrightCleared` itself, has no side effects, and is not wired into any
 * publish/API flow yet — Phase 2's publish flow is the intended caller.
 */
@Injectable()
export class CopyrightGateService {
  /**
   * Rule: `comedy` pillar content carries no copyright/licensing risk in
   * this system's judgment and never needs evidence. `drama` and `product`
   * pillar content carries real risk (licensed music, likeness/brand
   * rights) and needs a non-empty `copyrightEvidenceUrl` on file first.
   *
   * Content with no pillar assigned yet (`contentPillar: null`, e.g. not
   * yet classified by an admin) is treated the same as a risk-bearing
   * pillar — fail closed — so an unclassified item can never be cleared by
   * omission.
   */
  canMarkCopyrightCleared(content: CopyrightGateInput): boolean {
    if (content.contentPillar === ContentPillar.comedy) {
      return true;
    }
    return this.hasEvidence(content.copyrightEvidenceUrl);
  }

  private hasEvidence(evidenceUrl: string | null): boolean {
    return typeof evidenceUrl === 'string' && evidenceUrl.trim().length > 0;
  }
}
