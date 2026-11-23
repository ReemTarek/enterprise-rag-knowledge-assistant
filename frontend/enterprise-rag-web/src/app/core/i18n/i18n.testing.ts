import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader, provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import ar from '../../../assets/i18n/ar.json';
import de from '../../../assets/i18n/de.json';
import en from '../../../assets/i18n/en.json';
import { SUPPORTED_LANGUAGES } from './language.service';

const files: Record<string, Translation> = { en, de, ar };

@Injectable({ providedIn: 'root' })
export class InlineTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(files[lang] ?? {});
  }
}

/** Test-only providers: Transloco backed by the real JSON files, no HTTP. */
export const provideI18nTesting = () =>
  provideTransloco({
    config: { availableLangs: [...SUPPORTED_LANGUAGES], defaultLang: 'en', fallbackLang: 'en', prodMode: true },
    loader: InlineTranslationLoader,
  });
