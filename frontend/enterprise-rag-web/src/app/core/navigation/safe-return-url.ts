const MAX_LENGTH = 2048;

/**
 * Open-redirect guard for `returnUrl`. Accepts only an in-app absolute path: a string that starts with exactly one
 * `/` (so not `//host`, and no scheme or host), contains no backslash (browsers treat `\` as `/`, so `/\host` is
 * protocol-relative) and no control characters or whitespace-like prefixes. Anything else becomes `/`.
 */
export function sanitizeReturnUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return '/';
  if (value[0] !== '/' || value[1] === '/') return '/';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || value[i] === '\\') return '/';
  }
  return value;
}
