/**
 * Field-name-based redaction used by both the logging interceptor (normal
 * request/response logs) and the global exception filter (error/stack-trace
 * serialization). Security decision #4: the never-log rule must cover BOTH
 * paths — NestJS's default exception handling can dump full objects
 * (including nested tokens) into logs, so this helper is applied there too.
 *
 * Matching is by field name, case-insensitively, against a substring list —
 * deliberately broad so a new field like `newAccessToken` or
 * `metaRefreshToken` is caught without an allowlist edit.
 */
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'secret',
  'authorization',
  'cookie',
  'session',
  'client_secret',
  'clientsecret',
  'app_secret',
  'appsecret',
  'code', // OAuth authorization code
  'encryption_key',
  'encryptionkey',
];

/**
 * Phase 4 (System Analyst condition C1). Comment PII field names
 * (author/text/replyText/authorExternalId + the raw reply `message` body)
 * must be masked in audit/log/exception output — but by EXACT key, NOT the
 * substring matching above. A substring rule would mis-fire catastrophically:
 * `'author'.includes` would also clobber the intentionally-kept `authorRef`
 * hash and `authorExternalId`, and `'text'.includes` would clobber
 * `textLength` and any `context`/`contextId` field ("context".includes("text")
 * is true). Exact, case-insensitive matching masks the raw values while the
 * redacted references (`authorRef`, `textLength`) survive intact.
 */
const SENSITIVE_EXACT_KEYS = new Set([
  'author',
  'text',
  'replytext',
  'authorexternalid',
  'message',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Deep-clones a value while replacing any property whose key name matches a
 * sensitive pattern with a fixed redaction marker. Safe against circular
 * references and bounded in depth so a malformed object cannot hang logging.
 */
export function redactSensitive(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactStringIfLooksLikeSecret(value.message),
      stack: value.stack ? redactStackTrace(value.stack) : undefined,
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[CIRCULAR]';
    }
    seen.add(value as object);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(val, depth + 1, seen);
    }
    return result;
  }

  return value;
}

/** Stack traces can embed error messages that themselves contain secrets. */
function redactStackTrace(stack: string): string {
  return stack
    .split('\n')
    .map((line) => redactStringIfLooksLikeSecret(line))
    .join('\n');
}

/** Catches `key=value` / `key: value` fragments inside free-text strings. */
function redactStringIfLooksLikeSecret(text: string): string {
  return text.replace(
    /\b(password|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
    (match, key: string) => `${key}=${REDACTED}`,
  );
}
