-- CHECK constraint: target_age_min <= target_age_max on contents.
-- Not expressible in schema.prisma (Prisma has no CHECK-constraint syntax as
-- of this version), so it's added here as hand-written DDL. This is a
-- one-time migration file, not a runtime query — it does not conflict with
-- the ban on $queryRawUnsafe/$executeRawUnsafe (security decision #5), which
-- applies to application code paths, not migration DDL.
ALTER TABLE "contents"
  ADD CONSTRAINT "contents_target_age_range_check"
  CHECK ("target_age_min" <= "target_age_max");
