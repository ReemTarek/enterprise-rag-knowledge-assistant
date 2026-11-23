import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthStore } from '../../core/auth/auth.store';
import { currentUser, tokenResponse } from '../../core/auth/auth.testing';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';
import { LanguageService } from '../../core/i18n/language.service';
import { AppTitleStrategy } from '../../core/navigation/app-title.strategy';

function configure(opts: { admin?: boolean; mustChange?: boolean } = {}) {
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
  const store = TestBed.inject(AuthStore);
  store.setSession(tokenResponse('tok', opts.mustChange ?? false));
  store.setUser(
    currentUser({
      globalRole: opts.admin ? 'Admin' : 'User',
      mustChangePassword: opts.mustChange ?? false,
    }),
  );
  TestBed.inject(LanguageService).init();
  return store;
}

const shellOf = (h: RouterTestingHarness) =>
  h.routeNativeElement!.closest('app-shell') as HTMLElement;
const links = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));

describe('Shell', () => {
  it('Shell_ShowsAdminLinkOnlyForAdmin', async () => {
    configure({ admin: false });
    const h = await RouterTestingHarness.create('/knowledge-bases');
    expect(links(shellOf(h))).toEqual(['/knowledge-bases']);
  });

  it('Shell_ShowsAdminLinkForAdmin', async () => {
    configure({ admin: true });
    const h = await RouterTestingHarness.create('/knowledge-bases');
    expect(links(shellOf(h))).toEqual(['/knowledge-bases', '/admin']);
  });

  it('Shell_MustChange_HidesNavigation', async () => {
    configure({ mustChange: true });
    const h = await RouterTestingHarness.create('/knowledge-bases');
    const shell = shellOf(h);
    expect(TestBed.inject(Router).url).toContain('/change-password');
    expect(shell.querySelectorAll('nav a').length).toBe(0);
    expect(shell.querySelector('app-language-switcher')).not.toBeNull();
    expect(shell.querySelector('[data-testid=user-menu]')).not.toBeNull();
  });

  it('Shell_Logout_ClearsSessionAndRoutesToLogin', async () => {
    const store = configure();
    const h = await RouterTestingHarness.create('/knowledge-bases');
    shellOf(h).querySelector<HTMLButtonElement>('[data-testid=user-menu]')!.click();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.textContent).toContain('ada@example.com');
    overlay.querySelector<HTMLButtonElement>('[data-testid=logout]')!.click();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/logout')
      .flush(null, { status: 204, statusText: 'No Content' });
    await h.fixture.whenStable();
    expect(store.isAuthenticated()).toBe(false);
    expect(TestBed.inject(Router).url).toContain('/login');
  });

  it('Shell_Logout_RoutesToLogin_WithoutWaitingForServer', async () => {
    const store = configure();
    const h = await RouterTestingHarness.create('/knowledge-bases');
    shellOf(h).querySelector<HTMLButtonElement>('[data-testid=user-menu]')!.click();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    overlay.querySelector<HTMLButtonElement>('[data-testid=logout]')!.click();
    const ctrl = TestBed.inject(HttpTestingController);
    const pending = ctrl.expectOne('/api/auth/logout'); // never answered here
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('/login'));
    expect(store.isAuthenticated()).toBe(false);
    expect(pending.cancelled).toBe(false);
  });
});
