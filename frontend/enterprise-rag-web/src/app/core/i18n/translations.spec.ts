import ar from '../../../assets/i18n/ar.json';
import de from '../../../assets/i18n/de.json';
import en from '../../../assets/i18n/en.json';

const flatten = (obj: object, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const params = (s: string) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const all = { en: flatten(en), de: flatten(de), ar: flatten(ar) };

describe('Translations', () => {
  it('Translations_HaveSameKeysInAllLanguages', () => {
    const enKeys = Object.keys(all.en).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    expect(Object.keys(all.de).sort()).toEqual(enKeys);
    expect(Object.keys(all.ar).sort()).toEqual(enKeys);
    for (const lang of Object.values(all)) {
      for (const v of Object.values(lang)) {
        expect(typeof v).toBe('string');
        expect((v as string).trim()).not.toBe('');
      }
    }
  });

  it('Translations_NoPlaceholderMismatch', () => {
    for (const key of Object.keys(all.en)) {
      const expected = params(all.en[key] as string);
      expect(params(all.de[key] as string), `de ${key}`).toBe(expected);
      expect(params(all.ar[key] as string), `ar ${key}`).toBe(expected);
    }
  });
});
