import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PROBLEM_TYPES } from '../api/problem-details';
import { AUTH_CHANNEL_NAME, AuthChannel } from './auth-channel';
import { AuthService } from './auth.service';
import { AuthStore } from './auth.store';
import {
  AuthTestBed,
  RouterStub,
  currentUser,
  problem,
  setupAuthTesting,
  tokenResponse,
} from './auth.testing';
import { FakeBroadcastChannel } from './broadcast-channel.testing';

const TOKEN_A = 'tab-a-access-jwt.111.222';
const TOKEN_B = 'tab-b-access-jwt.333.444';
const USER = currentUser({ id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'ada@example.com' });

/** A second "tab": its own AuthStore/AuthService/AuthChannel and router, sharing only the (fake) BroadcastChannel. */
interface Tab {
  store: AuthStore;
  auth: AuthService;
  router: RouterStub;
  injector: EnvironmentInjector;
}

function openSecondTab(url = '/knowledge-bases'): Tab {
  const router: RouterStub = { url, navigate: vi.fn(() => Promise.resolve(true)) };
  const injector = createEnvironmentInjector(
    [AuthStore, AuthService, AuthChannel, { provide: Router, useValue: router }],
    TestBed.inject(EnvironmentInjector),
  );
  const tab = {
    store: injector.get(AuthStore),
    auth: injector.get(AuthService),
    router,
    injector,
  };
  tab.store.setSession(tokenResponse(TOKEN_B));
  tab.store.setUser(USER);
  return tab;
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('AuthChannel (cross-tab sign-out)', () => {
  let a: AuthTestBed;
  let b: Tab;

  beforeEach(() => {
    FakeBroadcastChannel.reset();
    a = setupAuthTesting();
    a.store.setSession(tokenResponse(TOKEN_A));
    a.store.setUser(USER);
    b = openSecondTab();
  });

  afterEach(() => {
    b.injector.destroy();
    a.ctrl.verify();
  });

  it('AuthChannel_LogoutInOneTab_ClearsOtherTab', async () => {
    const generationB = b.store.generation;
    a.auth.logout().subscribe();
    a.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(b.store.isAuthenticated()).toBe(false));
    expect(b.store.getAccessToken()).toBeNull();
    expect(b.store.user()).toBeNull();
    expect(b.store.generation).toBeGreaterThan(generationB);
    expect(b.router.navigate).toHaveBeenCalledOnce();
    expect(b.router.navigate).toHaveBeenCalledWith(['/login']);
    // The sender navigates itself (Shell.logout); its own message never comes back to it.
    expect(a.router.navigate).not.toHaveBeenCalled();
    // B handles the message without broadcasting again: exactly one message crossed, so no ping-pong.
    await flushMicrotasks();
    expect(FakeBroadcastChannel.posted).toHaveLength(1);
  });

  it('AuthChannel_MessageCarriesNoSecrets', () => {
    a.auth.logout().subscribe();
    a.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });

    expect(FakeBroadcastChannel.posted).toEqual([
      { name: AUTH_CHANNEL_NAME, data: { type: 'logout' } },
    ]);
    const wire = JSON.stringify(FakeBroadcastChannel.posted);
    for (const secret of [TOKEN_A, TOKEN_B, USER.id, USER.email, USER.displayName]) {
      expect(wire).not.toContain(secret);
    }
  });

  it('AuthChannel_ReceivingTabAlreadyOnLogin_DoesNotNavigate', async () => {
    b.router.url = '/login?returnUrl=%2Fknowledge-bases';
    a.auth.logout().subscribe();
    a.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(b.store.isAuthenticated()).toBe(false));
    expect(b.router.navigate).not.toHaveBeenCalled();
  });

  it('AuthChannel_RefreshRejected_EndsSessionInOtherTabs', async () => {
    // A's cookie was rejected: the interceptor ends the session and tells the other tabs (same cookie jar).
    let error: unknown;
    a.http.get('/api/me').subscribe({ error: (e) => (error = e) });
    a.ctrl
      .expectOne('/api/me')
      .flush(problem(401, PROBLEM_TYPES.unauthorized), { status: 401, statusText: 'x' });
    a.ctrl
      .expectOne('/api/auth/refresh')
      .flush(problem(401, PROBLEM_TYPES.unauthorized), { status: 401, statusText: 'x' });
    expect(error).toBeDefined();
    expect(a.store.isAuthenticated()).toBe(false);
    expect(a.router.navigate).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(b.store.isAuthenticated()).toBe(false));
    expect(b.router.navigate).toHaveBeenCalledOnce();
    await flushMicrotasks();
    expect(FakeBroadcastChannel.posted).toEqual([
      { name: AUTH_CHANNEL_NAME, data: { type: 'logout' } },
    ]);
  });

  it('AuthChannel_IgnoresUnknownMessages', async () => {
    const other = new FakeBroadcastChannel(AUTH_CHANNEL_NAME);
    other.postMessage({ type: 'login', accessToken: 'x' });
    other.postMessage('logout');
    other.postMessage(null);
    await flushMicrotasks();
    other.close();
    expect(b.store.isAuthenticated()).toBe(true);
    expect(a.store.isAuthenticated()).toBe(true);
    expect(b.router.navigate).not.toHaveBeenCalled();
  });

  it('AuthChannel_WithoutBroadcastChannel_IsANoOp', () => {
    localStorage.clear();
    sessionStorage.clear();
    const original = globalThis.BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const injector = createEnvironmentInjector(
        [AuthChannel],
        TestBed.inject(EnvironmentInjector),
      );
      const channel = injector.get(AuthChannel);
      let received = false;
      channel.logout$.subscribe(() => (received = true));
      expect(() => channel.publishLogout()).not.toThrow();
      expect(received).toBe(false);
      injector.destroy();
    } finally {
      globalThis.BroadcastChannel = original;
    }
    // Nothing fell back to web storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
