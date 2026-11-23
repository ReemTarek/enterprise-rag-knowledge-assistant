import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthStore } from './core/auth/auth.store';
import { currentUser, tokenResponse } from './core/auth/auth.testing';
import { provideI18nTesting } from './core/i18n/i18n.testing';
import { LanguageService } from './core/i18n/language.service';
import { AppTitleStrategy } from './core/navigation/app-title.strategy';

function configure(opts: { auth?: boolean; admin?: boolean } = { auth: true }) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: TitleStrategy, useClass: AppTitleStrategy },
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideI18nTesting(),
    ],
  });
  if (opts.auth) {
    const store = TestBed.inject(AuthStore);
    store.setSession(tokenResponse('tok'));
    store.setUser(currentUser({ globalRole: opts.admin ? 'Admin' : 'User' }));
  }
  TestBed.inject(LanguageService).init();
}

describe('Routes', () => {
  it('Routes_UnknownPath_ShowsNotFound', async () => {
    configure();
    const h = await RouterTestingHarness.create('/definitely/not/here');
    expect(h.routeNativeElement!.textContent).toContain('Page not found');
  });

  it('Routes_Root_RedirectsToKnowledgeBases', async () => {
    configure();
    await RouterTestingHarness.create('/');
    expect(TestBed.inject(Router).url).toBe('/knowledge-bases');
  });

  it('Routes_Anonymous_GoesToLoginWithReturnUrl', async () => {
    configure({ auth: false });
    await RouterTestingHarness.create('/settings');
    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fsettings');
  });

  it('Routes_NonAdmin_AdminShowsForbidden', async () => {
    configure();
    const h = await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/forbidden');
    expect(h.routeNativeElement!.textContent).toContain('Access denied');
  });

  it('Routes_Admin_LoadsAdminPlaceholder', async () => {
    configure({ auth: true, admin: true });
    await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin');
  });

  it('Routes_SetsTranslatedTitle', async () => {
    configure();
    await RouterTestingHarness.create('/settings');
    expect(TestBed.inject(Title).getTitle()).toBe('Settings - Enterprise RAG Knowledge Assistant');
  });

  it('Settings_ChangesLanguage_AndDirection', async () => {
    configure();
    const h = await RouterTestingHarness.create('/settings');
    const root = h.routeNativeElement!;
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios.map((r) => r.value)).toEqual(['en', 'de', 'ar']);
    radios[2].click();
    await h.fixture.whenStable();
    expect(TestBed.inject(LanguageService).current()).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(root.querySelector('a[href="/change-password"]')).not.toBeNull();
    radios[0].click();
    await h.fixture.whenStable();
    expect(document.documentElement.dir).toBe('ltr');
  });
});
