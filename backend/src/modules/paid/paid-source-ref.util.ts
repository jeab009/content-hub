import { BadRequestException } from '@nestjs/common';
import { PAID_SOURCE_REF_PATTERN } from './paid.constants';

/**
 * System Analyst condition P-A1 (docs/phase7-system-analyst-signoff.md §1,
 * §9): `AdPerformanceEntry.sourceRef` must be format-checked in THE SERVICE,
 * not only the DTO decorator — mirrors `assertStatementRefShape` /
 * `commerce-statement-ref.util.ts` exactly, including the reason it is a
 * standalone exported function rather than inlined into
 * `PaidPerformanceService`: it must be enforceable at BOTH ingestion seams,
 * the HTTP path (where `CreatePerformanceEntryDto`'s `@Matches` is a
 * redundant SECOND layer, not the primary one) and any future adapter-fed
 * path (7D), where class-validator decorators never run at all.
 *
 * The design draft's own quoted regex (`^[A-Za-z0-9._\-\/ ]+$`) contained a
 * space and would have let a pasted Latin-script name through — the exact
 * pre-fix Commerce regex Phase 6's SA-1 already rejected. `PAID_SOURCE_REF_
 * PATTERN` in `paid.constants.ts` is the corrected pattern; this function is
 * where it is actually enforced.
 */
export function assertPaidSourceRefShape(value: string | null | undefined): void {
  if (value === null || value === undefined) {
    return;
  }
  if (!PAID_SOURCE_REF_PATTERN.test(value)) {
    throw new BadRequestException(
      'sourceRef accepts letters, digits and . _ - / only (no spaces), starting with a letter ' +
        'or digit, max 64 characters — never audience, buyer, or individual-recipient detail.',
    );
  }
}
