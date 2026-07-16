/**
 * Seed script: creates exactly one admin user (Phase 1 is single-admin).
 *
 * Password handling is deliberate: this file is committed to the repo, so it
 * MUST NOT contain a real, usable password. Behavior:
 *   - If SEED_ADMIN_PASSWORD is set in the environment, that password is
 *     used (still validated against the password policy).
 *   - If it is unset, a cryptographically random password is generated and
 *     printed to stdout ONCE. It is never written to disk or logged again.
 *
 * Run with: npm run prisma:seed  (see backend/README section in the repo README)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import zxcvbn from 'zxcvbn';

const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12;
const MIN_ZXCVBN_SCORE = 3;

function generateRandomPassword(): string {
  // 24 random bytes -> 32 base64url chars: comfortably clears both the
  // length floor and the zxcvbn strength floor without any dictionary risk.
  return randomBytes(24).toString('base64url');
}

function assertPasswordMeetsPolicy(password: string, userInputs: string[]): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const result = zxcvbn(password, userInputs);
  if (result.score < MIN_ZXCVBN_SCORE) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is too weak (zxcvbn score ${result.score}/4, need >= ${MIN_ZXCVBN_SCORE}/4). Choose a stronger password.`,
    );
  }
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const name = process.env.SEED_ADMIN_NAME ?? 'Content Hub Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: admin user ${email} already exists (id ${existing.id}) — skipping.`);
    return;
  }

  const providedPassword = process.env.SEED_ADMIN_PASSWORD;
  const usingGeneratedPassword = !providedPassword;
  const password = providedPassword || generateRandomPassword();

  if (providedPassword) {
    assertPasswordMeetsPolicy(password, [email, name]);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: 'admin',
    },
  });

  console.log(`Seed: created admin user ${user.email} (id ${user.id}).`);
  if (usingGeneratedPassword) {
    console.log('');
    console.log('=================================================================');
    console.log('  Generated admin password (shown ONCE — save it now):');
    console.log(`  ${password}`);
    console.log('  Log in and consider this the initial credential; there is no');
    console.log('  self-service password-change endpoint in Phase 1.');
    console.log('=================================================================');
    console.log('');
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
