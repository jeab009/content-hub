# Security Decisions — Content Hub Phase 1

This document records the security decisions made while implementing Phase 1
("Foundation"), per the System Analyst's Step 3 review. It is meant to be
read by Quality Control, QA, and DevOps/Rollout, and to survive as the
reference doc for future phases.

## 1. Session fixation — regenerate session ID on login

`AuthController.login()` calls `request.session.regenerate()` **before**
writing `userId`/`csrfToken` into the session (`backend/src/modules/auth/auth.controller.ts`).
This guarantees a pre-login session id (which an attacker could have planted
via a crafted link, if the app were ever vulnerable to session-fixation
delivery) is never the one that becomes authenticated.

## 2. CSRF protection beyond SameSite

`SameSite=Lax` (set in `backend/src/main.ts` session cookie config) blocks
most cross-site POST-based CSRF but not all cross-site GET/simple-request
cases. A header-based token (`CsrfGuard`, `backend/src/common/guards/csrf.guard.ts`)
is required on every mutating endpoint except the OAuth callback (which is
instead protected by the OAuth `state` parameter — Meta's redirect can't
attach a custom header). The client fetches a token from `GET /api/auth/csrf`
after login and echoes it back via the `x-csrf-token` header.

## 3. Indistinguishable login failures

`AuthService.validateCredentials()` (`backend/src/modules/auth/auth.service.ts`)
always runs an Argon2 verify — against the real hash if the user exists,
against a fixed dummy hash otherwise — **before** branching on "not found" /
"locked" / "wrong password". All three paths throw the exact same
`UnauthorizedException('Invalid email or password')`. Covered by
`auth.service.spec.ts`, including a test that asserts all three failure
messages are byte-identical.

## 4. Redaction on the exception path, not just normal logs

`RedactingLoggingInterceptor` redacts normal request/response logs;
`RedactingExceptionFilter` (`backend/src/common/filters/redacting-exception.filter.ts`)
separately redacts before logging **any** uncaught exception, including its
stack trace. Both go through the same `redactSensitive()` helper
(`backend/src/common/utils/redact.util.ts`), which matches on field name
(password, token, secret, authorization, cookie, session, code, ...) at any
object depth, plus a regex pass over free-text strings (for secrets embedded
in an error message rather than a structured field). Covered by
`redact.util.spec.ts`.

## 5. No raw SQL escape hatches

`$queryRawUnsafe` / `$executeRawUnsafe` are banned via an ESLint
`no-restricted-syntax` rule (`backend/.eslintrc.cjs`) and a comment in
`prisma/schema.prisma` / `PrismaService`. All data access uses Prisma's
generated, parameterized query builder. The one place raw SQL appears at all
is the `target_age_min <= target_age_max` CHECK constraint, which is DDL in a
migration file (`prisma/migrations/20260715132900_content_age_range_check/`),
not a runtime query path — Prisma has no schema syntax for CHECK constraints.

## 6. Ownership/ACL checks

`ConnectedAccountsService.findOwnedOrThrow()` verifies `account.userId`
matches the authenticated caller on every read/mutate path
(`getValidToken`, `disconnect`) and throws `403 Forbidden` on mismatch (404
on a genuinely nonexistent id, so a 403 doesn't itself leak "this id exists
but isn't yours" vs "this id doesn't exist" — actually it does leak that
distinction today; see "Known limitation" below). Covered by
`connected-accounts.service.spec.ts`. This exists now, with only one role
value in the system, specifically so it isn't retrofitted later under
pressure once there are multiple users.

**Known limitation**: distinguishing 403 (exists, not yours) from 404
(doesn't exist) is a minor enumeration surface for connected-account UUIDs.
Given UUIDs aren't guessable and Phase 1 has exactly one admin account (so
"not yours" can only ever mean "belongs to a different Phase-1-nonexistent
user"), this is accepted as-is for Phase 1 and worth revisiting if
multi-user support is added.

## 7. Structured audit logging

`AuditLogService` (`backend/src/common/audit/audit-log.service.ts`) emits
structured JSON log lines (not free text) for: login success/failure,
account lockout, OAuth connect/disconnect, OAuth errors, and token-refresh
failures. Phase 1 has no dedicated audit-log table — the approved 5-table
schema doesn't include one — so this is log-line based, not queryable via
SQL. **This is a deliberate Phase 1 scope decision.** Revisit when
compliance or investigation needs require queryable audit history: add an
`AuditLog` table and have `AuditLogService` write to Postgres (or ship logs
to a log aggregator with retention/search) instead of/in addition to stdout.

## 8. Single-use authorization code retry UX

An OAuth authorization `code` can only be exchanged once. If a user
double-submits, uses the browser back button, or the callback URL is
reloaded, the second exchange attempt legitimately fails at Meta's end. The
callback handler's catch block (`ConnectedAccountsController.callback`)
redirects to `/settings?status=error&message=...` with the copy "Could not
connect to Facebook. Please retry the connection." — not a generic
"something went wrong" message — so the user understands the fix is to
restart the connect flow, not that the app is broken.

## 9. Prisma enum migrations are additive-only

Documented as a comment at the top of `prisma/schema.prisma`. Postgres enum
value removal/reordering is destructive (existing rows may reference values
about to disappear, and `ALTER TYPE ... DROP VALUE` doesn't even exist as a
built-in operation without a full type rebuild). This is a **process rule**,
not something Prisma or this codebase enforces mechanically — code review
must catch a migration PR that removes or reorders an enum value.

## 10. Token encryption — key-compromise runbook

`TokenEncryptionService` (`backend/src/modules/connected-accounts/services/token-encryption.service.ts`)
is the only code in the repo that touches `APP_ENCRYPTION_KEY` or performs
raw AES-256-GCM encrypt/decrypt. If the key is ever suspected compromised
(leaked env var, compromised secrets store, ex-employee with access, etc.):

1. **Rotate the key.** Generate a new 32-byte key
   (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
   set it as the new `APP_ENCRYPTION_KEY` in every environment.
2. **Null out every encrypted token column.** Every row's
   `access_token_encrypted` / `refresh_token_encrypted` was encrypted under
   the old key and is now unreadable (and, since the key is compromised,
   untrustworthy even if it were readable) — set both to `NULL` for all
   `ConnectedAccount` rows.
3. **Set `status = 'expired'` on every affected `ConnectedAccount` row.**
   Forces the app to treat every connection as needing reconnection; nothing
   silently keeps using a token that might have been exfiltrated.
4. **Force reconnect.** The admin must go through the OAuth connect flow
   again for every platform account. There is no way to recover the old
   tokens — this is intentional; a compromised key means the old ciphertext
   can no longer be trusted even if technically decryptable with a backup of
   the old key.
5. **Audit.** Check `AuditLogService` output around the suspected compromise
   window for unexpected `connected_account.oauth.connect` /
   `token_refresh` entries that might indicate the key was actively misused
   before rotation.

### KMS migration — when to revisit

Phase 1 uses a single symmetric key from an environment variable
(`APP_ENCRYPTION_KEY`), deliberately simple for a single-admin, single-server
system. Migrate to a managed KMS (AWS KMS, GCP KMS, or HashiCorp Vault) when
**any** of the following becomes true:

- **Phase 2+ begins and token volume/platform count grows** — more
  platforms (YouTube, TikTok, LINE) and more connected accounts increase the
  blast radius of a single leaked env var, and centralized key rotation
  becomes operationally necessary.
- **More than one person or environment holds secret-store access** — the
  current model assumes a small, trusted set of people can read the
  production `.env`. Once that set grows (more engineers, a staging
  environment with its own copy of the key, a CI system that needs it),
  audit trails and per-identity access control (which a KMS provides, and a
  shared env var does not) become necessary.
- **A compliance requirement mandates it** — e.g., SOC 2, PCI-adjacent
  obligations if payment data enters scope, or a customer/partner contract
  requiring HSM-backed key management.
- **Budget allows** — KMS services have a real per-operation and per-key
  cost; this was consciously deferred rather than adding infrastructure
  spend to a Phase 1 MVP with one admin user.

## 11. Meta App Review status

Tracked separately in `docs/meta-app-review-status.md` — a checklist template
for the admin to complete, since this build has no access to the real Meta
Business Manager/App Review state.

## Deviation from the locked architecture spec: `accessTokenEncrypted` is nullable

The Step 2 architecture doc listed `ConnectedAccount.access_token_encrypted`
as `text` (not marked nullable), but the Step 3 security review's disconnect
flow explicitly requires: *"DELETE /api/connected-accounts/:id → ...
overwrite encrypted token columns to null."* These two requirements
conflict. Overwriting a non-nullable column with an empty string (`''`)
instead of `NULL` was rejected as a workaround — it would make "disconnected,
no token" indistinguishable from "connected with a zero-length token" at the
type level, and complicates every future reader's null-check. `accessTokenEncrypted`
was made nullable (`String?` in `prisma/schema.prisma`) to satisfy the
mandatory security fix. `getValidToken()` throws `ConflictException` if the
column is null or the account isn't `connected`, so no caller can silently
treat a disconnected account's absent token as a valid one.
