import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
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

  it('Routes_Admin_RedirectsToUsersPage', async () => {
    configure({ auth: true, admin: true });
    await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin/users');
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

describe('Must-change on the real router', () => {
  const blocked = ['/admin', '/settings', '/forbidden', '/no/such/page', '/knowledge-bases'];

  function configureMustChange(admin: boolean) {
    configure({ auth: true, admin });
    TestBed.inject(AuthStore).setMustChangePassword(true);
  }

  it.each([false, true])(
    'MustChange_RealRouter_BlocksAdminSettingsForbiddenAndNotFound (admin=%s)',
    async (admin) => {
      configureMustChange(admin);
      const h = await RouterTestingHarness.create();
      for (const url of blocked) {
        await h.navigateByUrl(url);
        expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
      }
    },
  );

  it('MustChange_RealRouter_SecondNavigationStillBlocked', async () => {
    configureMustChange(true);
    const h = await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
    await TestBed.inject(Router).navigateByUrl('/settings');
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
    await h.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
  });

  it.each(['/', '/knowledge-bases'])(
    'MustChange_AfterRestoreSession_LandsOnChangePassword (%s)',
    async (url) => {
      configure({ auth: false });
      const ctrl = TestBed.inject(HttpTestingController);
      let restored: boolean | undefined;
      TestBed.inject(AuthService)
        .restoreSession()
        .subscribe((r) => (restored = r));
      ctrl.expectOne('/api/auth/refresh').flush(tokenResponse('tok', true));
      ctrl.expectOne('/api/me').flush(currentUser({ mustChangePassword: true }));
      expect(restored).toBe(true);

      await RouterTestingHarness.create(url);
      expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
      ctrl.verify();
    },
  );

  it('MustChange_Cleared_RoutesWorkAgain', async () => {
    configureMustChange(false);
    const h = await RouterTestingHarness.create('/settings');
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/change-password');
    TestBed.inject(AuthStore).setMustChangePassword(false);
    await h.navigateByUrl('/settings');
    expect(TestBed.inject(Router).url).toBe('/settings');
    await h.navigateByUrl('/forbidden');
    expect(TestBed.inject(Router).url).toBe('/forbidden');
    await h.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/forbidden');
    await h.navigateByUrl('/no/such/page');
    expect(h.routeNativeElement!.textContent).toContain('Page not found');
  });
});
