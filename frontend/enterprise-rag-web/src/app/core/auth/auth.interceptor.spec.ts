import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../api/api-error';
import { PROBLEM_TYPES } from '../api/problem-details';
import { AuthTestBed, problem, setupAuthTesting, tokenResponse } from './auth.testing';

const OLD = 'old-access-jwt.aaa.bbb';
const NEW = 'new-access-jwt.ccc.ddd';

describe('authInterceptor', () => {
  let t: AuthTestBed;

  beforeEach(() => {
    t = setupAuthTesting('/knowledge-bases/42');
  });

  afterEach(() => t.ctrl.verify());

  const signIn = (accessToken = OLD) => t.store.setSession(tokenResponse(accessToken));
  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('Interceptor_AddsBearer_ToApiCalls_NotToLogin', () => {
    t.http.get('/api/me').subscribe();
    expect(t.ctrl.expectOne('/api/me').request.headers.has('Authorization')).toBe(false);

    signIn();
    t.http.get('/api/me').subscribe();
    t.http.post('/api/auth/password', {}).subscribe();
    t.http.post('/api/auth/login', {}).subscribe();
    t.http.post('/api/auth/refresh', null).subscribe();
    t.http.post('/api/auth/logout', null).subscribe();

    expect(t.ctrl.expectOne('/api/me').request.headers.get('Authorization')).toBe(`Bearer ${OLD}`);
    expect(t.ctrl.expectOne('/api/auth/password').request.headers.get('Authorization')).toBe(
      `Bearer ${OLD}`,
    );
    for (const url of ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']) {
      expect(t.ctrl.expectOne(url).request.headers.has('Authorization')).toBe(false);
    }
  });

  it('Interceptor_DoesNotTouchNonApiUrls', () => {
    signIn();
    let error: unknown;
    t.http.get('/assets/i18n/en.json').subscribe({ error: (e) => (error = e) });
    t.http.get('/apiary').subscribe({ error: () => undefined });
    t.http.get('https://evil.example/api/me').subscribe({ error: () => undefined });

    const asset = t.ctrl.expectOne('/assets/i18n/en.json');
    expect(asset.request.headers.has('Authorization')).toBe(false);
    asset.flush('nope', unauthorized);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(error).not.toBeInstanceOf(ApiError);

    for (const url of ['/apiary', 'https://evil.example/api/me']) {
      const req = t.ctrl.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush('nope', unauthorized);
    }
    // No refresh was attempted for any of these 401s (verify() in afterEach), no logout.
    expect(t.store.getAccessToken()).toBe(OLD);
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('Interceptor_On401_RefreshesOnce_ForConcurrentRequests', () => {
    signIn();
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      t.http.get(`/api/items/${i}`).subscribe((r) => results.push(r));
    }
    for (let i = 0; i < 5; i++) {
      const req = t.ctrl.expectOne(`/api/items/${i}`);
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${OLD}`);
      req.flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    }

    // expectOne fails if more than one refresh request is pending.
    const refresh = t.ctrl.expectOne('/api/auth/refresh');
    expect(refresh.request.method).toBe('POST');
    expect(refresh.request.withCredentials).toBe(true);
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    refresh.flush(tokenResponse(NEW));

    for (let i = 0; i < 5; i++) {
      const retry = t.ctrl.expectOne(`/api/items/${i}`);
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${NEW}`);
      retry.flush({ i });
    }
    expect(results).toHaveLength(5);
    expect(t.store.getAccessToken()).toBe(NEW);
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('Interceptor_Late401AfterRefresh_RetriesWithCurrentToken_WithoutRefreshing', () => {
    signIn();
    let late: unknown;
    t.http.get('/api/a').subscribe();
    t.http.get('/api/late').subscribe((r) => (late = r));
    t.ctrl.expectOne('/api/a').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse(NEW));
    t.ctrl.expectOne('/api/a').flush({});

    // A request sent with the old token fails after the refresh already completed: no second refresh.
    t.ctrl.expectOne('/api/late').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    const retry = t.ctrl.expectOne('/api/late');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${NEW}`);
    retry.flush({ ok: true });
    expect(late).toEqual({ ok: true });
  });

  /** Two requests fail with 401 and queue behind one refresh (single-flight); returns that refresh. */
  function twoRequestsThenRefresh() {
    signIn();
    const errors: unknown[] = [];
    t.http.get('/api/one').subscribe({ error: (e) => errors.push(e) });
    t.http.get('/api/two').subscribe({ error: (e) => errors.push(e) });
    t.ctrl.expectOne('/api/one').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    t.ctrl.expectOne('/api/two').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    return { errors, refresh: t.ctrl.expectOne('/api/auth/refresh') };
  }
  type RefreshRequest = ReturnType<typeof twoRequestsThenRefresh>['refresh'];

  it('Interceptor_RefreshFails401_LogsOutAndRedirectsToLogin_NoLoop', () => {
    const { errors, refresh } = twoRequestsThenRefresh();
    refresh.flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);

    // verify() in afterEach: no second refresh, no retries.
    expect(errors).toHaveLength(2);
    for (const e of errors) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(401);
    }
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.getAccessToken()).toBeNull();
    expect(t.router.navigate).toHaveBeenCalledOnce();
    expect(t.router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/knowledge-bases/42' },
    });
  });

  for (const status of [400, 403]) {
    it(`Interceptor_RefreshFails${status}_LogsOut`, () => {
      const { errors, refresh } = twoRequestsThenRefresh();
      refresh.flush(problem(status, PROBLEM_TYPES.badRequest), { status, statusText: 'x' });
      expect(errors).toHaveLength(2);
      expect(t.store.isAuthenticated()).toBe(false);
      expect(t.router.navigate).toHaveBeenCalledOnce();
    });
  }

  const transientFailures: [string, (r: RefreshRequest) => void, number, string][] = [
    ['Network', (r) => r.error(new ProgressEvent('error')), 0, 'network'],
    [
      '429',
      (r) =>
        r.flush(problem(429, PROBLEM_TYPES.tooManyRequests), {
          status: 429,
          statusText: 'Too Many Requests',
        }),
      429,
      PROBLEM_TYPES.tooManyRequests,
    ],
    // A proxy 502/503/504 without a ProblemDetails body is the network kind (D8); the session is still kept.
    [
      '503',
      (r) => r.flush(null, { status: 503, statusText: 'Service Unavailable' }),
      503,
      'network',
    ],
    [
      '502Html',
      (r) => r.flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      502,
      'network',
    ],
    [
      '503Problem',
      (r) =>
        r.flush(problem(503, 'https://enterprise-rag.local/problems/http-503'), {
          status: 503,
          statusText: 'Service Unavailable',
        }),
      503,
      'https://enterprise-rag.local/problems/http-503',
    ],
  ];
  for (const [name, fail, status, type] of transientFailures) {
    it(`Interceptor_RefreshFails${name}_KeepsSession_FailsWithRefreshError`, () => {
      const { errors, refresh } = twoRequestsThenRefresh();
      fail(refresh);

      // Every queued request gets the same outcome: the refresh's own error, not the original 401.
      expect(errors).toHaveLength(2);
      for (const e of errors) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(status);
        expect((e as ApiError).type).toBe(type);
      }
      expect(t.store.isAuthenticated()).toBe(true);
      expect(t.store.getAccessToken()).toBe(OLD);
      expect(t.router.navigate).not.toHaveBeenCalled();

      // The next 401 tries the refresh again (single-flight was reset) and recovers.
      let ok: unknown;
      t.http.get('/api/three').subscribe((r) => (ok = r));
      t.ctrl.expectOne('/api/three').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
      t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse(NEW));
      const retry = t.ctrl.expectOne('/api/three');
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${NEW}`);
      retry.flush({ ok: true });
      expect(ok).toEqual({ ok: true });
    });
  }

  it('Interceptor_TokenArrivingAfterLogout_IsNotUsedForRetry', () => {
    signIn();
    let error: unknown;
    t.http.get('/api/one').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/one').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    const refresh = t.ctrl.expectOne('/api/auth/refresh');

    t.auth.logout().subscribe();
    t.ctrl.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    refresh.flush(tokenResponse(NEW));

    // verify() in afterEach: the retry of /api/one was never sent.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.store.getAccessToken()).toBeNull();
    // The shell navigates on logout; the interceptor adds no redirect of its own.
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('Interceptor_RetryStill401_DoesNotRefreshAgain', () => {
    signIn();
    let error: unknown;
    t.http.get('/api/stale').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/stale').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    t.ctrl.expectOne('/api/auth/refresh').flush(tokenResponse(NEW));

    const retry = t.ctrl.expectOne('/api/stale');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${NEW}`);
    retry.flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);

    expect(t.ctrl.match('/api/auth/refresh')).toHaveLength(0);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(t.store.isAuthenticated()).toBe(false);
    expect(t.router.navigate).toHaveBeenCalledOnce();
    expect(t.router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/knowledge-bases/42' },
    });
  });

  it('Interceptor_401WithoutBearer_IsMappedButNotRefreshed', () => {
    let error: unknown;
    t.http.get('/api/me').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/me').flush(problem(401, PROBLEM_TYPES.unauthorized), unauthorized);
    expect(error).toBeInstanceOf(ApiError);
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('Interceptor_On403PasswordChangeRequired_RedirectsToChangePassword', () => {
    signIn();
    let error: unknown;
    t.http.get('/api/knowledge-bases').subscribe({ error: (e) => (error = e) });
    t.ctrl
      .expectOne('/api/knowledge-bases')
      .flush(problem(403, PROBLEM_TYPES.passwordChangeRequired, 'Password change required'), {
        status: 403,
        statusText: 'Forbidden',
      });

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isPasswordChangeRequired).toBe(true);
    expect(t.store.mustChangePassword()).toBe(true);
    expect(t.store.getAccessToken()).toBe(OLD); // session kept
    expect(t.router.navigate).toHaveBeenCalledWith(['/change-password']);
  });

  it('Interceptor_OrdinaryForbidden_DoesNotRedirect', () => {
    signIn();
    let error: unknown;
    t.http.get('/api/admin/users').subscribe({ error: (e) => (error = e) });
    t.ctrl
      .expectOne('/api/admin/users')
      .flush(problem(403, PROBLEM_TYPES.forbidden), { status: 403, statusText: 'Forbidden' });
    expect((error as ApiError).type).toBe(PROBLEM_TYPES.forbidden);
    expect(t.store.mustChangePassword()).toBe(false);
    expect(t.router.navigate).not.toHaveBeenCalled();
  });

  it('ApiError_MapsProblemDetails_AndCorrelationId', () => {
    signIn();
    let error: ApiError | undefined;
    t.http.post('/api/knowledge-bases', {}).subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/knowledge-bases').flush(
      {
        ...problem(400, PROBLEM_TYPES.validation, 'Validation failed', 'cid-body'),
        errors: { name: ['Required.'] },
      },
      { status: 400, statusText: 'Bad Request', headers: { 'X-Correlation-Id': 'cid-header' } },
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(400);
    expect(error?.type).toBe(PROBLEM_TYPES.validation);
    expect(error?.title).toBe('Validation failed');
    expect(error?.correlationId).toBe('cid-body');
    expect(error?.errors).toEqual({ name: ['Required.'] });
  });

  it('ApiError_EmptyBody_UsesHeaderCorrelationId', () => {
    signIn();
    let error: ApiError | undefined;
    t.http.delete('/api/knowledge-bases/1').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/knowledge-bases/1').flush(null, {
      status: 499,
      statusText: 'Client Closed Request',
      headers: { 'X-Correlation-Id': 'cid-499' },
    });
    expect(error?.status).toBe(499);
    expect(error?.type).toBe('https://enterprise-rag.local/problems/http-499');
    expect(error?.correlationId).toBe('cid-499');
  });

  it('ApiError_NetworkFailure_IsStatusZero', () => {
    signIn();
    let error: ApiError | undefined;
    t.http.get('/api/me').subscribe({ error: (e) => (error = e) });
    t.ctrl.expectOne('/api/me').error(new ProgressEvent('error'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(0);
    expect(error?.type).toBe('network');
    expect(t.store.getAccessToken()).toBe(OLD);
  });
});
