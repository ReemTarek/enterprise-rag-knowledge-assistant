/**
 * Texts of the direction-isolated elements under `root`: `<bdi>` and any element with a `dir` attribute (both get
 * `unicode-bidi: isolate` from the UA stylesheet), so user-supplied Latin text cannot be reordered by RTL context.
 */
export function isolatedTexts(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('bdi, [dir]')).map((e) => (e.textContent ?? '').trim());
}
