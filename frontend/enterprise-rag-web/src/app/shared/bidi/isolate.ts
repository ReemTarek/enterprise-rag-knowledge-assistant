const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/**
 * Wraps user-supplied text (a name, an email, a KB name) in Unicode FSI...PDI before it is interpolated into a
 * translated sentence, so a Latin value inside an Arabic sentence (or the reverse) keeps its own direction and
 * cannot reorder the surrounding punctuation. This is the plain-text equivalent of `<bdi>`, for strings that are
 * rendered as text (dialog messages); templates use `<bdi>` directly.
 */
export function isolate(text: string): string {
  return FIRST_STRONG_ISOLATE + text + POP_DIRECTIONAL_ISOLATE;
}
