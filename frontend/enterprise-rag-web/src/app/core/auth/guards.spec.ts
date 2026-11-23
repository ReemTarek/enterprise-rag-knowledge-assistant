import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { adminGuard } from './admin.guard';
import { authGuard } from './auth.guard';
import { currentUser, tokenResponse } from './auth.testing';
import { AuthStore } from './auth.store';
import { anonymousGuard, mustChangeGuard } from './must-change.guard';

const state = (url: string) => ({ url }) as RouterStateSnapshot;
const route = {} as ActivatedRouteSnapshot;
const run = <T>(fn: () => T) => TestBed.runInInjectionContext(fn);
const asString = (r: unknown) => TestBed.inject(Router).serializeUrl(r as UrlTree);

describe('guards', () => {
  let store: AuthStore;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthStore);
  });

  it('AuthGuard_Anonymous_RedirectsToLoginWithReturnUrl', () => {
    const result = run(() => authGuard(route, state('/knowledge-bases?x=1')));
    expect(asString(result)).toBe('/login?returnUrl=%2Fknowledge-bases%3Fx%3D1');
  });

  it('AuthGuard_Authenticated_Allows', () => {
    store.setSession(tokenResponse('t'));
    expect(run(() => authGuard(route, state('/x')))).toBe(true);
  });

  it('AnonymousGuard_Authenticated_RedirectsHome', () => {
    expect(run(() => anonymousGuard(route, state('/login')))).toBe(true);
    store.setSession(tokenResponse('t'));
    expect(asString(run(() => anonymousGuard(route, state('/login'))))).toBe('/');
  });

  it('MustChangeGuard_MustChange_RedirectsEverythingExceptChangePassword', () => {
    store.setSession(tokenResponse('t', true));
    store.setUser(currentUser({ globalRole: 'Admin', mustChangePassword: true }));
    for (const url of ['/knowledge-bases', '/settings', '/admin', '/nope']) {
      expect(asString(run(() => mustChangeGuard(route, state(url))))).toBe(
        `/change-password?returnUrl=${encodeURIComponent(url)}`,
      );
    }
    expect(run(() => mustChangeGuard(route, state('/change-password')))).toBe(true);
    expect(run(() => mustChangeGuard(route, state('/change-password?returnUrl=%2Fx')))).toBe(true);
  });

  it('MustChangeGuard_NoFlag_Allows', () => {
    store.setSession(tokenResponse('t'));
    expect(run(() => mustChangeGuard(route, state('/settings')))).toBe(true);
  });

  it('AdminGuard_NonAdmin_Blocks', () => {
    store.setSession(tokenResponse('t'));
    store.setUser(currentUser());
    expect(asString(run(() => adminGuard(route, state('/admin'))))).toBe('/forbidden');
    store.setUser(currentUser({ globalRole: 'Admin' }));
    expect(run(() => adminGuard(route, state('/admin')))).toBe(true);
  });
});
