import { ForbiddenException } from '@nestjs/common';

import { assertAiAllowed, isAiAllowed } from './ai-access';

describe('AI access allowlist', () => {
  it('allows the owner account', () => {
    expect(isAiAllowed('omrialt@gmail.com')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isAiAllowed('  OmriAlt@Gmail.com ')).toBe(true);
  });

  it.each([
    'demo.client@example.com',
    'omrialt@gmail.com.evil.example',
    'xomrialt@gmail.com',
    '',
    '   ',
    undefined,
    null,
  ])('refuses %p', (email) => {
    expect(isAiAllowed(email)).toBe(false);
  });

  it('assertAiAllowed throws 403 for anyone else and passes for the owner', () => {
    expect(() => assertAiAllowed('demo.client@example.com')).toThrow(
      ForbiddenException,
    );
    expect(() => assertAiAllowed(undefined)).toThrow(ForbiddenException);
    expect(() => assertAiAllowed('omrialt@gmail.com')).not.toThrow();
  });
});
