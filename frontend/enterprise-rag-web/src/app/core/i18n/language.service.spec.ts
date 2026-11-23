import { Directionality } from '@angular/cdk/bidi';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideI18nTesting } from './i18n.testing';
import { LanguageService } from './language.service';

describe('LanguageService', () => {
  const setNavigatorLanguage = (lang: string) =>
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(lang);

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    TestBed.configureTestingModule({ providers: [provideI18nTesting()] });
  });

  afterEach(() => vi.restoreAllMocks());

  it('LanguageService_Arabic_SetsRtlAndLang', () => {
    const svc = TestBed.inject(LanguageService);
    svc.set('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(svc.current()).toBe('ar');
    expect(svc.dir()).toBe('rtl');
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('ar');
  });

  it('LanguageService_English_SetsLtr', () => {
    const svc = TestBed.inject(LanguageService);
    svc.set('ar');
    svc.set('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(svc.dir()).toBe('ltr');
    svc.set('de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('LanguageService_DefaultsToBrowserLanguageIfSupported_ElseEnglish', () => {
    setNavigatorLanguage('de-DE');
    TestBed.inject(LanguageService).init();
    expect(TestBed.inject(LanguageService).current()).toBe('de');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideI18nTesting()] });
    setNavigatorLanguage('fr-FR');
    TestBed.inject(LanguageService).init();
    expect(TestBed.inject(LanguageService).current()).toBe('en');
  });

  it('LanguageService_UsesStoredLanguageOverBrowser_IgnoringInvalidValues', () => {
    setNavigatorLanguage('de-DE');
    localStorage.setItem('lang', 'ar');
    const svc = TestBed.inject(LanguageService);
    svc.init();
    expect(svc.current()).toBe('ar');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideI18nTesting()] });
    localStorage.setItem('lang', 'xx');
    const svc2 = TestBed.inject(LanguageService);
    svc2.init();
    expect(svc2.current()).toBe('de');
  });

  it('LanguageService_PersistsChoice_AndSurvivesStorageFailure', () => {
    const svc = TestBed.inject(LanguageService);
    svc.set('de');
    expect(localStorage.getItem('lang')).toBe('de');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => svc.set('ar')).not.toThrow();
    expect(svc.current()).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(() => svc.init()).not.toThrow();
  });

  it('LanguageService_Rtl_UpdatesCdkDirectionality', () => {
    const directionality = TestBed.inject(Directionality);
    expect(directionality.value).toBe('ltr');
    TestBed.inject(LanguageService).set('ar');
    expect(directionality.value).toBe('rtl');
    TestBed.inject(LanguageService).set('en');
    expect(directionality.value).toBe('ltr');
  });
});
