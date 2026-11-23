import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClientService);
  private readonly store = inject(AuthStore);

  /** The in-flight refresh shared by every caller (single-flight); reset when it settles. */
  private refreshInFlight: Observable<string> | null = null;

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
    this.refreshInFlight ??= this.requestToken().pipe(
      finalize(() => (this.refreshInFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
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

  /** Revokes the refresh family server-side, then always clears the local session. Never errors; caller navigates. */
  logout(): Observable<void> {
    return this.api.post<unknown>(AUTH_URLS.logout, null).pipe(
      catchError(() => of(null)),
      map(() => this.store.clear()),
      finalize(() => this.store.clear()),
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

  private requestToken(): Observable<string> {
    return this.api.post<TokenResponse>(AUTH_URLS.refresh, null).pipe(
      tap((session) => this.store.setSession(session)),
      map((session) => session.accessToken),
    );
  }
}
