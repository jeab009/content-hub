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

/**
 * Phase 1.5 placeholder split across the three content pillars. Explicitly
 * marked `isProvisional: true` with a note calling out that this is a
 * default, not a real business decision — see bussiness_rule.md and
 * System Analyst Phase 1.5 approval notes. Nothing reads this table yet
 * (Phase 3 ranking engine will); seeding it now just avoids Phase 3 needing
 * a data migration to backfill starter values.
 */
const PILLAR_RATIO_SEED: Array<{
  contentPillar: 'product' | 'drama' | 'comedy';
  targetRatioPct: number;
}> = [
  { contentPillar: 'product', targetRatioPct: 40 },
  { contentPillar: 'drama', targetRatioPct: 30 },
  { contentPillar: 'comedy', targetRatioPct: 30 },
];

const PILLAR_RATIO_NOTE =
  'default placeholder pending admin confirmation — do not treat as final business decision';

/**
 * Phase 1.5 placeholder posting cadence per platform. Same "provisional,
 * not a real decision" caveat as PILLAR_RATIO_SEED above.
 */
const CADENCE_SEED: Array<{
  platform: 'facebook' | 'youtube' | 'tiktok' | 'line_oa';
  targetPostsPerPeriod: number;
  periodUnit: 'week' | 'month';
}> = [
  { platform: 'facebook', targetPostsPerPeriod: 7, periodUnit: 'week' },
  { platform: 'youtube', targetPostsPerPeriod: 3, periodUnit: 'week' },
];

async function seedPillarRatioPolicies(effectiveFrom: Date): Promise<void> {
  for (const seed of PILLAR_RATIO_SEED) {
    const existing = await prisma.pillarRatioPolicy.findFirst({
      where: { contentPillar: seed.contentPillar },
    });
    if (existing) {
      console.log(`Seed: pillar ratio policy for ${seed.contentPillar} already exists — skipping.`);
      continue;
    }

    await prisma.pillarRatioPolicy.create({
      data: {
        contentPillar: seed.contentPillar,
        targetRatioPct: seed.targetRatioPct,
        effectiveFrom,
        isProvisional: true,
        createdByNote: PILLAR_RATIO_NOTE,
      },
    });
    console.log(`Seed: created provisional pillar ratio policy for ${seed.contentPillar}.`);
  }
}

async function seedPlatformCadenceTargets(effectiveFrom: Date): Promise<void> {
  for (const seed of CADENCE_SEED) {
    const existing = await prisma.platformCadenceTarget.findFirst({
      where: { platform: seed.platform },
    });
    if (existing) {
      console.log(`Seed: platform cadence target for ${seed.platform} already exists — skipping.`);
      continue;
    }

    await prisma.platformCadenceTarget.create({
      data: {
        platform: seed.platform,
        targetPostsPerPeriod: seed.targetPostsPerPeriod,
        periodUnit: seed.periodUnit,
        effectiveFrom,
        isProvisional: true,
      },
    });
    console.log(`Seed: created provisional platform cadence target for ${seed.platform}.`);
  }
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const name = process.env.SEED_ADMIN_NAME ?? 'Content Hub Admin';

  const today = new Date();
  await seedPillarRatioPolicies(today);
  await seedPlatformCadenceTargets(today);

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
