import { Injectable } from '@nestjs/common';
import zxcvbn from 'zxcvbn';

const MIN_LENGTH = 12;
const MIN_ZXCVBN_SCORE = 3;

export interface PasswordPolicyResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Password policy: min 12 chars + zxcvbn score >= 3 (approved architecture).
 * Used by the seed script when an operator supplies SEED_ADMIN_PASSWORD, and
 * is the place any future password-change/reset endpoint should call into.
 */
@Injectable()
export class PasswordPolicyService {
  evaluate(password: string, userInputs: string[] = []): PasswordPolicyResult {
    const reasons: string[] = [];

    if (password.length < MIN_LENGTH) {
      reasons.push(`Password must be at least ${MIN_LENGTH} characters long`);
    }

    const result = zxcvbn(password, userInputs);
    if (result.score < MIN_ZXCVBN_SCORE) {
      reasons.push(
        `Password is too weak (strength score ${result.score}/4, minimum required is ${MIN_ZXCVBN_SCORE}/4)`,
      );
    }

    return { valid: reasons.length === 0, reasons };
  }
}
