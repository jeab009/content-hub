import { BadRequestException } from '@nestjs/common';
import { COMMERCE_STATEMENT_REF_PATTERN } from './commerce.constants';

/**
 * QA-1 (carried-forward finding, blocking prerequisite for 6A.7):
 * `COMMERCE_STATEMENT_REF_PATTERN` existed since the 6.0 gate but nothing
 * enforced it — QA proved `'John Smith'` inserted fine at the DB level,
 * which has only a length CHECK, on the documented assumption of a service
 * guard that had not yet been built.
 *
 * Exported as a standalone function, not inlined into
 * `CommerceConversionService`, because it must be enforced at BOTH
 * ingestion seams: the HTTP path (`CreateConversionDto`'s `@Matches` is a
 * redundant SECOND layer, not the primary one — see commerce.constants.ts)
 * and any future adapter-fed path, where `ConversionSnapshot.statementRef`
 * flows from `CommerceAdapter.fetchConversions()` straight into a row
 * without ever touching class-validator. A control that lives only on the
 * DTO is absent from the exact path it was written to guard.
 */
export function assertStatementRefShape(value: string | null | undefined): void {
  if (value === null || value === undefined) {
    return;
  }
  if (!COMMERCE_STATEMENT_REF_PATTERN.test(value)) {
    throw new BadRequestException(
      'statementRef accepts letters, digits and . _ - / only (no spaces), starting with a ' +
        'letter or digit, max 64 characters — never buyer or order details.',
    );
  }
}
