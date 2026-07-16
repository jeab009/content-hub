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
});
