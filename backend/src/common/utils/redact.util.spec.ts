import { redactSensitive } from './redact.util';

describe('redactSensitive', () => {
  it('redacts known sensitive field names at the top level', () => {
    const result = redactSensitive({ password: 'hunter2', email: 'a@b.com' }) as Record<
      string,
      unknown
    >;

    expect(result.password).toBe('[REDACTED]');
    expect(result.email).toBe('a@b.com');
  });

  it('redacts nested sensitive fields at any depth', () => {
    const result = redactSensitive({
      user: { profile: { accessToken: 'abc123', name: 'Jeab' } },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(result.user.profile.accessToken).toBe('[REDACTED]');
    expect(result.user.profile.name).toBe('Jeab');
  });

  it('redacts fields inside arrays', () => {
    const result = redactSensitive([{ refresh_token: 'xyz' }, { ok: true }]) as Record<
      string,
      unknown
    >[];
    expect(result[0].refresh_token).toBe('[REDACTED]');
    expect(result[1].ok).toBe(true);
  });

  it('redacts Error message/stack via the exception-path helper', () => {
    const err = new Error('failed with token=abc.def.ghi during exchange');
    const result = redactSensitive(err) as { message: string };
    expect(result.message).not.toContain('abc.def.ghi');
  });

  it('does not throw on circular references', () => {
    const obj: Record<string, unknown> = { name: 'x' };
    obj.self = obj;
    expect(() => redactSensitive(obj)).not.toThrow();
  });

  it('leaves non-sensitive data untouched', () => {
    const input = { id: '123', platform: 'facebook', count: 5 };
    expect(redactSensitive(input)).toEqual(input);
  });

  // Phase 4 — System Analyst condition C1. Comment PII fields are matched by
  // EXACT key; the intentionally-kept audit references must NOT be clobbered.
  describe('comment PII (C1) — exact-key masking, references survive', () => {
    it('masks raw author/text/replyText/authorExternalId and the reply message body', () => {
      const result = redactSensitive({
        author: 'สมชาย ใจดี',
        text: 'บริการแย่มาก',
        replyText: 'ขออภัยครับ',
        authorExternalId: 'psid-123',
        message: 'my reply body',
      }) as Record<string, unknown>;

      expect(result.author).toBe('[REDACTED]');
      expect(result.text).toBe('[REDACTED]');
      expect(result.replyText).toBe('[REDACTED]');
      expect(result.authorExternalId).toBe('[REDACTED]');
      expect(result.message).toBe('[REDACTED]');
    });

    it('keeps the redacted references authorRef/textLength and any context field', () => {
      const result = redactSensitive({
        commentId: 'c-1',
        authorRef: 'a1b2c3d4e5f6',
        textLength: 42,
        contextId: 'ctx-9',
        context: 'inbox',
        sentiment: 'negative',
      }) as Record<string, unknown>;

      expect(result.authorRef).toBe('a1b2c3d4e5f6');
      expect(result.textLength).toBe(42);
      expect(result.contextId).toBe('ctx-9');
      expect(result.context).toBe('inbox');
      expect(result.sentiment).toBe('negative');
    });

    it('masks nested raw comment fields on the exception/log path', () => {
      const err = new Error('reply failed');
      (err as unknown as { comment: unknown }).comment = {
        author: 'raw name',
        text: 'raw comment',
        authorRef: 'keepme12',
      };
      const result = redactSensitive({
        error: err,
        comment: (err as unknown as { comment: unknown }).comment,
      }) as {
        comment: Record<string, unknown>;
      };
      expect(result.comment.author).toBe('[REDACTED]');
      expect(result.comment.text).toBe('[REDACTED]');
      expect(result.comment.authorRef).toBe('keepme12');
    });
  });
});
