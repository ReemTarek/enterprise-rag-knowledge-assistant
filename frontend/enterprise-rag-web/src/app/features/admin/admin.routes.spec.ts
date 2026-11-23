import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthStore } from '../../core/auth/auth.store';
import { currentUser, tokenResponse } from '../../core/auth/auth.testing';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';

describe('Admin routes', () => {
  function configure(globalRole: 'User' | 'Admin') {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    const store = TestBed.inject(AuthStore);
    store.setSession(tokenResponse('tok'));
    store.setUser(currentUser({ globalRole }));
  }

  it('AdminRoute_NonAdmin_Forbidden', async () => {
    configure('User');
    await RouterTestingHarness.create('/admin/users');
    expect(TestBed.inject(Router).url).toBe('/forbidden');
  });

  it('AdminRoute_Admin_RedirectsToUsers', async () => {
    configure('Admin');
    await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin/users');
  });
});
