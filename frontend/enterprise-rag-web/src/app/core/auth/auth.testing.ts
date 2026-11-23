import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { CurrentUser, TokenResponse } from './auth.models';
import { AuthService } from './auth.service';
import { AuthStore } from './auth.store';

/** Router stand-in: records navigations, exposes a settable current url. */
export interface RouterStub {
  url: string;
  navigate: ReturnType<typeof vi.fn>;
}

export interface AuthTestBed {
  http: HttpClient;
  ctrl: HttpTestingController;
  store: AuthStore;
  auth: AuthService;
  router: RouterStub;
}

/** Real HttpClient + the real auth interceptor against HttpTestingController, with a stub Router. */
export function setupAuthTesting(currentUrl = '/knowledge-bases'): AuthTestBed {
  const router: RouterStub = { url: currentUrl, navigate: vi.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Router, useValue: router },
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    store: TestBed.inject(AuthStore),
    auth: TestBed.inject(AuthService),
    router,
  };
}

export function tokenResponse(accessToken: string, mustChangePassword = false): TokenResponse {
  return { accessToken, expiresAtUtc: '2026-11-23T12:15:00Z', mustChangePassword };
}

export function currentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: '7d1f6c1e-0000-4000-8000-000000000001',
    email: 'ada@example.com',
    displayName: 'Ada',
    globalRole: 'User',
    mustChangePassword: false,
    ...overrides,
  };
}

export function problem(status: number, type: string, title = 'Problem', correlationId = 'cid-1') {
  return { type, title, status, traceId: '00-abc', correlationId };
}
