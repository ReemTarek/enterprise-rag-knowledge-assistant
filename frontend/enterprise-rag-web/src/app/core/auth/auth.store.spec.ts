import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';
import { currentUser, tokenResponse } from './auth.testing';

describe('AuthStore', () => {
  let store: AuthStore;

  beforeEach(() => {
    store = TestBed.inject(AuthStore);
  });

  it('AuthStore_StartsSignedOut', () => {
    expect(store.getAccessToken()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.isAdmin()).toBe(false);
    expect(store.mustChangePassword()).toBe(false);
  });

  it('AuthStore_SetSession_And_SetUser', () => {
    store.setSession(tokenResponse('jwt-1', true));
    expect(store.getAccessToken()).toBe('jwt-1');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.mustChangePassword()).toBe(true);

    store.setUser(currentUser({ globalRole: 'User', mustChangePassword: false }));
    expect(store.isAdmin()).toBe(false);
    expect(store.mustChangePassword()).toBe(false);

    store.setUser(currentUser({ globalRole: 'Admin' }));
    expect(store.isAdmin()).toBe(true);
  });

  it('AuthStore_SetMustChangePassword_UpdatesUserToo', () => {
    store.setSession(tokenResponse('jwt-1'));
    store.setUser(currentUser());
    store.setMustChangePassword(true);
    expect(store.mustChangePassword()).toBe(true);
    expect(store.user()?.mustChangePassword).toBe(true);
  });

  it('AuthStore_Clear_ResetsEverything', () => {
    store.setSession(tokenResponse('jwt-1', true));
    store.setUser(currentUser({ globalRole: 'Admin' }));
    store.clear();
    expect(store.getAccessToken()).toBeNull();
    expect(store.expiresAtUtc()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.isAdmin()).toBe(false);
    expect(store.mustChangePassword()).toBe(false);
  });

  it('AuthStore_DoesNotExposeTokenAsPublicState', () => {
    store.setSession(tokenResponse('jwt-secret'));
    // Only getAccessToken() yields the token; no enumerable public property holds it.
    expect(JSON.stringify(store)).not.toContain('jwt-secret');
    expect(Object.keys(store).some((k) => k.toLowerCase().includes('accesstoken'))).toBe(false);
  });
});
