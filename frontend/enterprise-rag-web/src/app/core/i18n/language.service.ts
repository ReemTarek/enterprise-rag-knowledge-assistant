import { Directionality } from '@angular/cdk/bidi';
import { DOCUMENT, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

export const SUPPORTED_LANGUAGES = ['en', 'de', 'ar'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'lang';
const RTL_LANGUAGES: readonly SupportedLanguage[] = ['ar'];

export const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);
  private readonly directionality = inject(Directionality);
  private readonly lang = signal<SupportedLanguage>('en');

  readonly current: Signal<SupportedLanguage> = this.lang.asReadonly();
  readonly dir: Signal<'ltr' | 'rtl'> = computed(() => (RTL_LANGUAGES.includes(this.lang()) ? 'rtl' : 'ltr'));

  /** Picks stored language, else the browser language if supported, else English. */
  init(): void {
    this.apply(this.readStored() ?? this.fromBrowser() ?? 'en');
  }

  set(lang: SupportedLanguage): void {
    this.apply(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage unavailable (private mode, quota): the choice just won't persist.
    }
  }

  private apply(lang: SupportedLanguage): void {
    this.lang.set(lang);
    const dir = this.dir();
    const root = this.document.documentElement;
    root.lang = lang;
    root.dir = dir;
    this.transloco.setActiveLang(lang);
    // CDK reads the document direction only once at construction, so keep it in sync.
    if (this.directionality.value !== dir) {
      this.directionality.valueSignal.set(dir);
      this.directionality.change.emit(dir);
    }
  }

  private readStored(): SupportedLanguage | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return isSupportedLanguage(value) ? value : null;
    } catch {
      return null;
    }
  }

  private fromBrowser(): SupportedLanguage | null {
    const prefix = (globalThis.navigator?.language ?? '').slice(0, 2).toLowerCase();
    return isSupportedLanguage(prefix) ? prefix : null;
  }
}
