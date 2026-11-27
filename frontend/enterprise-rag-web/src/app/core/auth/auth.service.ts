import { Injectable, Injector, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  defer,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
  timeout,
} from 'rxjs';
import { ApiClientService } from '../api/api-client.service';
import { ApiError } from '../api/api-error';
import { PROBLEM_TYPES } from '../api/problem-details';
import { AuthChannel } from './auth-channel';
import { ChangePasswordRequest, CurrentUser, LoginRequest, TokenResponse } from './auth.models';
import { AuthStore } from './auth.store';

export const AUTH_URLS = {
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  password: '/api/auth/password',
  me: '/api/me',
} as const;

/** App start must not hang on a slow or dead API: restoreSession gives up after this. */
export const RESTORE_SESSION_TIMEOUT_MS = 5000;

/** Sign-out never waits on the server longer than this; the local session is already gone by then. */
export const LOGOUT_TIMEOUT_MS = 5000;

/** The error a token request fails with when the session ended (logout) while it was in flight. */
function sessionEnded(): ApiError {
  return new ApiError({ type: PROBLEM_TYPES.unauthorized, title: 'Session ended', status: 401 });
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClientService);
  private readonly store = inject(AuthStore);
  private readonly channel = inject(AuthChannel);
  private readonly injector = inject(Injector);

  /** The in-flight refresh shared by every caller (single-flight); reset when it settles. */
  private refreshInFlight: Observable<string> | null = null;

  constructor() {
    // Created at app start (the session-restore initializer), so every tab listens from the beginning.
    this.channel.logout$.pipe(takeUntilDestroyed()).subscribe(() => this.signedOutElsewhere());
  }

  login(email: string, password: string): Observable<void> {
    const body: LoginRequest = { email, password };
    return this.api.post<TokenResponse>(AUTH_URLS.login, body).pipe(
      tap((session) => this.store.setSession(session)),
      switchMap(() => this.loadMe()),
      map(() => undefined),
      catchError((error: unknown) => {
        this.store.clear();
        return throwError(() => error);
      }),
    );
  }

  /**
   * Single-flight cookie refresh: concurrent callers share one `POST /api/auth/refresh`. Emits the new access token.
   * The refresh cookie rotates on every call, so issuing two at once would trip the server's reuse detection.
   */
  refresh(): Observable<string> {
    if (!this.refreshInFlight) {
      const flight: Observable<string> = this.requestToken().pipe(
        // Only reset if still current: logout() may already have detached this flight and a new one started.
        finalize(() => {
          if (this.refreshInFlight === flight) this.refreshInFlight = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.refreshInFlight = flight;
    }
    return this.refreshInFlight;
  }

  /**
   * App start: trade the HttpOnly refresh cookie for an access token, then load the user. Emits true on success and
   * false on any failure (no cookie, 401, network, timeout); never errors. Uses its own request (not the shared
   * refresh) so that the timeout cancels it.
   */
  restoreSession(): Observable<boolean> {
    return this.requestToken().pipe(
      switchMap(() => this.loadMe()),
      map(() => true),
      timeout({ first: RESTORE_SESSION_TIMEOUT_MS }),
      catchError(() => {
        this.store.clear();
        return of(false);
      }),
    );
  }

  /**
   * Signs out locally at once (synchronously, before the server answers, even if nobody subscribes), then asks the
   * server to revoke the refresh family: best effort, at most LOGOUT_TIMEOUT_MS, never errors. Clearing the store
   * starts a new session generation, so a refresh still in flight cannot sign the client back in. The other open tabs
   * are told to sign out too (AuthChannel; the message carries no session data). Caller navigates.
   */
  logout(): Observable<void> {
    this.store.clear();
    this.refreshInFlight = null;
    this.channel.publishLogout();
    return this.api.post<unknown>(AUTH_URLS.logout, null).pipe(
      timeout({ first: LOGOUT_TIMEOUT_MS }),
      catchError(() => of(null)),
      map(() => undefined),
    );
  }

  /** On success the same session continues (the server keeps the caller's refresh family); only the flag clears. */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    const body: ChangePasswordRequest = { currentPassword, newPassword };
    return this.api
      .post<unknown>(AUTH_URLS.password, body)
      .pipe(map(() => this.store.setMustChangePassword(false)));
  }

  loadMe(): Observable<CurrentUser> {
    return this.api.get<CurrentUser>(AUTH_URLS.me).pipe(tap((user) => this.store.setUser(user)));
  }

  /**
   * Another tab signed out (or its refresh cookie was rejected): the shared refresh cookie is gone, so drop the
   * in-memory session here too and go to /login. Clearing bumps the generation, so an in-flight refresh cannot sign
   * this tab back in. Does not publish again (no ping-pong between tabs) and does not navigate when already on /login.
   */
  private signedOutElsewhere(): void {
    this.store.clear();
    this.refreshInFlight = null;
    const router = this.injector.get(Router);
    if (!router.url.startsWith('/login')) void router.navigate(['/login']);
  }

  /**
   * POST /api/auth/refresh. The session generation is captured when the request starts; if the store was cleared
   * meanwhile (logout), the new token is dropped and the caller gets an auth error instead of being signed back in.
   */
  private requestToken(): Observable<string> {
    return defer(() => {
      const generation = this.store.generation;
      return this.api.post<TokenResponse>(AUTH_URLS.refresh, null).pipe(
        map((session) => {
          if (this.store.generation !== generation) throw sessionEnded();
          this.store.setSession(session);
          return session.accessToken;
        }),
      );
    });
  }
}
