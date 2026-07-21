import { redact } from './logger.middleware';

describe('redact', () => {
  it('masks password fields', () => {
    expect(redact({ email: 'a@b.com', password: 'hunter2' })).toEqual({
      email: 'a@b.com',
      password: '[REDACTED]',
    });
  });

  it('masks every credential-bearing field name used by the auth routes', () => {
    const body = {
      password: 'p',
      newPassword: 'p',
      oldPassword: 'p',
      confirmPassword: 'p',
      token: 't',
      refreshToken: 't',
      resetPasswordToken: 't',
    };

    const out = redact(body) as Record<string, string>;
    expect(Object.values(out).every((v) => v === '[REDACTED]')).toBe(true);
  });

  it('matches field names case-insensitively', () => {
    expect(redact({ PassWord: 'x', ACCESSTOKEN: 'y' })).toEqual({
      PassWord: '[REDACTED]',
      ACCESSTOKEN: '[REDACTED]',
    });
  });

  it('reaches nested objects and arrays', () => {
    expect(
      redact({ users: [{ name: 'a', password: 'p' }], meta: { token: 't' } }),
    ).toEqual({
      users: [{ name: 'a', password: '[REDACTED]' }],
      meta: { token: '[REDACTED]' },
    });
  });

  it('leaves non-sensitive values untouched', () => {
    const body = { title: 'Leg day', sets: 5, done: true, note: null };
    expect(redact(body)).toEqual(body);
  });

  it('does not blow up on deeply nested or cyclic-looking input', () => {
    let deep: Record<string, unknown> = { password: 'p' };
    for (let i = 0; i < 20; i++) deep = { nested: deep };

    expect(() => JSON.stringify(redact(deep))).not.toThrow();
  });
});
