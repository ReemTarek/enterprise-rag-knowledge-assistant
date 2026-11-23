import { ApiError } from '../api/api-error';
import { PROBLEM_TYPES } from '../api/problem-details';
import { LOGOUT_TIMEOUT_MS } from './auth.service';
import { AuthTestBed, currentUser, problem, setupAuthTesting, tokenResponse } from './auth.testing';

const TOKEN = 'login-access-jwt.111.222';
const ROTATED = 'rotated-access-jwt.333.444';
const PASSWORD = 'Sup3r-Secret-Pa55!';
const NEW_PASSWORD = 'An0ther-Secret-Pa55!';

describe('AuthService', () => {
  let t: AuthTestBed;

  beforeEach(() => {
    t = setupAuthTesting();
  });

  afterEach(() => {
    t.ctrl.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function completeLogin(token = TOKEN, mustChange = false) {
    let done = false;
    t.auth.login('ada@example.com', PASSWORD).subscribe({ complete: () => (done = true) });
    const login = t.ctrl.expectOne('/api/auth/login');
    login.flush(tokenResponse(token, mustChange));
    t.ctrl
      .expectOne('/api/me')
      .flush(currentUser({ mustChangePassword: mustChange, globalRole: 'Admin' }));
    return () => done;
  }

  it('Login_Success_StoresTokenInMemory_AndLoadsMe', () => {
    let done = false;
    t.auth.login('ada@example.com', PASSWORD).subscribe({ complete: () => (done = true) });

    const login = t.ctrl.expectOne('/api/auth/login');
    expect(login.request.method).toBe('POST');
    expect(login.request.body).toEqual({ email: 'ada@example.com', password: PASSWORD });
    expect(login.request.withCredentials).toBe(true);
    expect(login.request.headers.has('Authorization')).toBe(false);
    login.flush(tokenResponse(TOKEN));

    const me = t.ctrl.expectOne('/api/me');
    expect(me.request.method).toBe('GET');
    expect(me.request.withCredentials).toBe(false);
    expect(me.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    me.flush(currentUser({ globalRole: 'Admin' }));

    expect(done).toBe(true);
    expect(t.store.getAccessToken()).toBe(TOKEN);
    expect(t.store.expiresAtUtc()).toBe('2026-11-23T12:15:00Z');
    expect(t.store.isAuthenticated()).toBe(true);
    expect(t.store.user()?.email).toBe('ada@example.com');
    expect(t.store.isAdmin()).toBe(true);
    expect(t.store.mustChangePassword()).toBe(false);
  });

  it('Login_MustChangePassword_SetsFlag', () => {
    completeLogin(TOKEN, true);
    expect(t.store.mustChangePassword()).toBe(true);
    expect(t.store.isAuthenticated()).toBe(true);
  });

  it('Login_Failure_MapsGeneric401', () => {
    let error: unknown;
    t.auth.login('ada@example.com', 'wrong').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/auth/login').flush(
      {
        ...problem(401, PROBLEM_TYPES.unauthorized, 'Unauthorized'),
        detail: 'Invalid credentials.',
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    // verify() in afterEach asserts that no refresh was attempted.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).type).toBe(PROBLEM_TYPES.unauthorized);
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.user()).toBeNull();
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('Login_MeFails_ClearsSession', () => {
    let error: unknown;
    t.auth.login('ada@example.com', PASSWORD).subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/auth/login').flush(tokenResponse(TOKEN));
    t.ctrl.expectOne('/api/me').flush(problem(500, PROBLEM_TYPES.internalError), {
      status: 500,
      statusText: 'Server Error',
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(t.store.isAuthenticated()).toBe(false);
  });

  it('Refresh_IsSingleFlight_AndResetsAfterCompletion', () => {
    t.store.setSession(tokenResponse(TOKEN));
    const got: string[] = [];
    t.auth.refresh().subscribe((v) => got.push(v));
    t.auth.refresh().subscribe((v) => got.push(v));
    const req = t.ctrl.expectOne('/api/auth/refresh');
    expect(req.request.body).toBeNull();
    req.flush(tokenResponse(ROTATED));
    expect(got).toEqual([ROTATED, ROTATED]);
    expect(t.store.getAccessToken()).toBe(ROTATED);

    t.auth.refresh().subscribe();
    t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse('third'));
    expect(t.store.getAccessToken()).toBe('third');
  });

  it('RestoreSession_UsesCookieRefresh_OnAppStart', () => {
    let result: boolean | undefined;
    t.auth.restoreSession().subscribe((r) => (result = r));

    const refresh = t.ctrl.expectOne('/api/auth/refresh');
    expect(refresh.request.method).toBe('POST');
    expect(refresh.request.withCredentials).toBe(true);
    expect(refresh.request.body).toBeNull();
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    refresh.flush(tokenResponse(TOKEN));

    const me = t.ctrl.expectOne('/api/me');
    expect(me.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    me.flush(currentUser());

    expect(result).toBe(true);
    expect(t.store.isAuthenticated()).toBe(true);
    expect(t.store.user()?.displayName).toBe('Ada');
  });

  it('RestoreSession_Returns false_On401_WithoutThrowingOrRedirecting', () => {
    let result: boolean | undefined;
    let error: unknown;
    t.auth.restoreSession().subscribe({ next: (r) => (result = r), error: (e) => (error = e) });
    t.ctrl
      .expectOne('/api/auth/refresh')
      .flush(problem(401, PROBLEM_TYPES.unauthorized), { status: 401, statusText: 'Unauthorized' });
    expect(result).toBe(false);
    expect(error).toBeUndefined();
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('RestoreSession_TimesOutAfterFiveSeconds_ReturnsFalse', () => {
    vi.useFakeTimers();
    let result: boolean | undefined;
    t.auth.restoreSession().subscribe((r) => (result = r));
    const refresh = t.ctrl.expectOne('/api/auth/refresh');

    vi.advanceTimersByTime(4999);
    expect(result).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(result).toBe(false);
    expect(refresh.cancelled).toBe(true);
    expect(t.store.isAuthenticated()).toBe(false);
  });

  it('ChangePassword_ClearsMustChangeFlag_KeepsSession', () => {
    completeLogin(TOKEN, true);
    expect(t.store.mustChangePassword()).toBe(true);

    let done = false;
    t.auth.changePassword(PASSWORD, NEW_PASSWORD).subscribe({ complete: () => (done = true) });
    const req = t.ctrl.expectOne('/api/auth/password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(t.store.mustChangePassword()).toBe(false);
    expect(t.store.user()?.mustChangePassword).toBe(false);
    expect(t.store.getAccessToken()).toBe(TOKEN);
    expect(t.store.isAuthenticated()).toBe(true);
  });

  it('ChangePassword_Failure_KeepsFlag', () => {
    completeLogin(TOKEN, true);
    let error: unknown;
    t.auth.changePassword('wrong', NEW_PASSWORD).subscribe({ error: (e) => (error = e) });
    t.ctrl
      .expectOne('/api/auth/password')
      .flush(problem(400, PROBLEM_TYPES.businessRule), { status: 400, statusText: 'Bad Request' });
    expect(error).toBeInstanceOf(ApiError);
    expect(t.store.mustChangePassword()).toBe(true);
  });

  it('Logout_ClearsStoreEvenIfServerFails', () => {
    completeLogin();
    let done = false;
    let error: unknown;
    t.auth.logout().subscribe({ complete: () => (done = true), error: (e) => (error = e) });
    const req = t.ctrl.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(problem(500, PROBLEM_TYPES.internalError), {
      status: 500,
      statusText: 'Server Error',
    });

    expect(error).toBeUndefined();
    expect(done).toBe(true);
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.user()).toBeNull();
  });

  it('Logout_ClearsSynchronously_EvenIfServerNeverResponds', () => {
    completeLogin();
    vi.useFakeTimers();
    let done = false;
    let error: unknown;
    t.auth.logout().subscribe({ complete: () => (done = true), error: (e) => (error = e) });

    // Signed out locally before the server has answered.
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.getAccessToken()).toBeNull();
    expect(t.store.user()).toBeNull();
    const req = t.ctrl.expectOne('/api/auth/logout');

    vi.advanceTimersByTime(LOGOUT_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    vi.advanceTimersByTime(1);
    expect(done).toBe(true);
    expect(error).toBeUndefined();
    expect(req.cancelled).toBe(true);
  });

  it('Logout_ClearsStore_EvenWithoutSubscriber', () => {
    completeLogin();
    t.auth.logout();
    expect(t.store.isAuthenticated()).toBe(false);
  });

  it('Refresh_ResolvingAfterLogout_DoesNotResignIn', () => {
    completeLogin();
    let error: unknown;
    let token: string | undefined;
    t.auth.refresh().subscribe({ next: (v) => (token = v), error: (e) => (error = e) });
    const refresh = t.ctrl.expectOne('/api/auth/refresh');

    t.auth.logout().subscribe();
    t.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    refresh.flush(tokenResponse(ROTATED));

    expect(token).toBeUndefined();
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.getAccessToken()).toBeNull();

    // A refresh started after logout is a new flight, not the dropped one.
    t.auth.refresh().subscribe();
    t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse('again'));
    expect(t.store.getAccessToken()).toBe('again');
  });

  it('RestoreSession_ResolvingAfterLogout_DoesNotResignIn', () => {
    let result: boolean | undefined;
    t.auth.restoreSession().subscribe((r) => (result = r));
    const refresh = t.ctrl.expectOne('/api/auth/refresh');
    t.auth.logout().subscribe();
    t.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    refresh.flush(tokenResponse(TOKEN));
    expect(result).toBe(false);
    expect(t.store.isAuthenticated()).toBe(false);
  });

  it('RestoreSession_MustChange_SetsFlag', () => {
    let result: boolean | undefined;
    t.auth.restoreSession().subscribe((r) => (result = r));
    t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse(TOKEN, true));
    // Set from the refresh response already, before /api/me answers.
    expect(t.store.mustChangePassword()).toBe(true);
    t.ctrl.expectOne('/api/me').flush(currentUser({ mustChangePassword: true }));
    expect(result).toBe(true);
    expect(t.store.mustChangePassword()).toBe(true);
    expect(t.store.user()?.mustChangePassword).toBe(true);
  });

  it('Logout_Success_ClearsStore', () => {
    completeLogin();
    t.auth.logout().subscribe();
    t.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(t.store.getAccessToken()).toBeNull();
  });

  it('Token_IsNeverWrittenToStorage', () => {
    const secrets = [TOKEN, ROTATED, PASSWORD, NEW_PASSWORD];
    const carriesSecret = (args: unknown[]) =>
      args.some((a) => secrets.some((s) => String(a).includes(s)));

    const storageWrites = vi.spyOn(Storage.prototype, 'setItem');
    const cookieWrites = vi.fn();
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: cookieWrites,
    });
    const idbOpen = vi.fn();
    if (globalThis.indexedDB) {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(idbOpen);
    } else {
      vi.stubGlobal('indexedDB', { open: idbOpen });
    }
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );

    try {
      // login
      completeLogin(TOKEN);
      // 401 -> refresh -> retry
      t.http.get('/api/knowledge-bases').subscribe();
      t.ctrl.expectOne('/api/knowledge-bases').flush(problem(401, PROBLEM_TYPES.unauthorized), {
        status: 401,
        statusText: 'Unauthorized',
      });
      t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse(ROTATED));
      t.ctrl.expectOne('/api/knowledge-bases').flush({ items: [] });
      // password change
      t.auth.changePassword(PASSWORD, NEW_PASSWORD).subscribe();
      t.ctrl.expectOne('/api/auth/password').flush(null, { status: 204, statusText: 'No Content' });
      // logout
      t.auth.logout().subscribe();
      t.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    } finally {
      delete (document as unknown as Record<string, unknown>)['cookie'];
      if (cookieDescriptor) Object.defineProperty(Document.prototype, 'cookie', cookieDescriptor);
    }

    expect(storageWrites).not.toHaveBeenCalled();
    expect(storageWrites.mock.calls.some(carriesSecret)).toBe(false);
    expect(cookieWrites).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    for (const spy of consoleCalls) {
      expect(spy.mock.calls.some(carriesSecret)).toBe(false);
    }
    const webStores = [window.localStorage, window.sessionStorage];
    for (const s of webStores) {
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i) ?? '';
        expect(carriesSecret([key, s.getItem(key)])).toBe(false);
      }
    }
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(ROTATED);
  });
});
