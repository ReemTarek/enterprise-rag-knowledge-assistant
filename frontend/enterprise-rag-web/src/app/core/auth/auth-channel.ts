import { DestroyRef, Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Name of the same-origin channel the open tabs of this app share. */
export const AUTH_CHANNEL_NAME = 'erag-auth';

/** The only message that crosses tabs. Deliberately carries no token, user id, email or other session data. */
export interface AuthChannelMessage {
  readonly type: 'logout';
}

const isLogoutMessage = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'logout';

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(AUTH_CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Cross-tab sign-out. All tabs share the HttpOnly refresh cookie, so once one tab signs out (or its refresh cookie is
 * rejected) the others must drop their in-memory access token too, instead of working on until it expires.
 * Backed by `BroadcastChannel`; where that is unavailable this is a no-op (the other tabs then end at token expiry).
 * There is intentionally no `storage`-event fallback: nothing session-related is written to web storage.
 * A channel never receives its own messages, so the publishing tab is not notified of its own logout.
 */
@Injectable({ providedIn: 'root' })
export class AuthChannel {
  readonly #channel = openChannel();
  readonly #logout = new Subject<void>();

  /** Emits when another tab of this app signed out. */
  readonly logout$: Observable<void> = this.#logout.asObservable();

  constructor() {
    const onMessage = (event: MessageEvent): void => {
      if (isLogoutMessage(event.data)) this.#logout.next();
    };
    this.#channel?.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => {
      this.#channel?.removeEventListener('message', onMessage);
      this.#channel?.close();
      this.#logout.complete();
    });
  }

  /** Tells the other tabs that the session ended. Best effort: never throws. */
  publishLogout(): void {
    const message: AuthChannelMessage = { type: 'logout' };
    try {
      this.#channel?.postMessage(message);
    } catch {
      // Channel already closed (app shutting down): nothing to tell.
    }
  }
}
