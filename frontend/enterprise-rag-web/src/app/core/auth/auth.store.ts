import { Injectable, Signal, computed, signal } from '@angular/core';
import { CurrentUser, TokenResponse } from './auth.models';

/**
 * In-memory session state. The access token lives only in an ECMAScript-private signal: it is never written to
 * web storage, IndexedDB, cookies, URLs or logs, and is not exposed as public reactive state (templates cannot bind
 * it). Only the auth interceptor and AuthService read it, through getAccessToken(). A reload loses it by design; the
 * session is restored from the HttpOnly refresh cookie (AuthService.restoreSession).
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly #accessToken = signal<string | null>(null);
  readonly #expiresAtUtc = signal<string | null>(null);
  readonly #user = signal<CurrentUser | null>(null);
  readonly #mustChangePassword = signal(false);

  readonly user: Signal<CurrentUser | null> = this.#user.asReadonly();
  readonly mustChangePassword: Signal<boolean> = this.#mustChangePassword.asReadonly();
  readonly expiresAtUtc: Signal<string | null> = this.#expiresAtUtc.asReadonly();
  readonly isAuthenticated: Signal<boolean> = computed(() => this.#accessToken() !== null);
  readonly isAdmin: Signal<boolean> = computed(() => this.#user()?.globalRole === 'Admin');

  getAccessToken(): string | null {
    return this.#accessToken();
  }

  /** Stores the result of login/refresh. The user (from GET /api/me) is kept as is. */
  setSession(session: TokenResponse): void {
    this.#accessToken.set(session.accessToken);
    this.#expiresAtUtc.set(session.expiresAtUtc);
    this.#mustChangePassword.set(session.mustChangePassword);
  }

  setUser(user: CurrentUser): void {
    this.#user.set(user);
    this.#mustChangePassword.set(user.mustChangePassword);
  }

  setMustChangePassword(value: boolean): void {
    this.#mustChangePassword.set(value);
    this.#user.update((u) => (u ? { ...u, mustChangePassword: value } : u));
  }

  clear(): void {
    this.#accessToken.set(null);
    this.#expiresAtUtc.set(null);
    this.#user.set(null);
    this.#mustChangePassword.set(false);
  }
}
