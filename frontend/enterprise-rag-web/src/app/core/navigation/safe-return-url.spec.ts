import { sanitizeReturnUrl } from './safe-return-url';

describe('sanitizeReturnUrl', () => {
  it.each(['/', '/knowledge-bases', '/knowledge-bases/42?tab=docs#x', '/..//x', '/settings'])(
    'accepts %s',
    (v) => expect(sanitizeReturnUrl(v)).toBe(v),
  );

  it.each([
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'evil.com',
    '',
    '/a\\b',
    '/a\nb',
    '/a\tb',
    '/a\u0000b',
    '/a\u007fb',
    ' /a',
    `/${'a'.repeat(3000)}`,
    null,
    undefined,
    42,
  ])('rejects %j', (v) => expect(sanitizeReturnUrl(v)).toBe('/'));
});
