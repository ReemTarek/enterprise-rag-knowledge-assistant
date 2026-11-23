import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

const CHANGE_PASSWORD = '/change-password';
const pathOf = (url: string) => url.split(/[?#]/, 1)[0];

/**
 * Placed on the shell route as canActivateChild so every child navigation is covered: while the account must change
 * its password, everything except /change-password redirects there (carrying the wanted URL as `returnUrl`).
 */
export const mustChangeGuard: CanActivateChildFn = (_route, state) => {
  if (!inject(AuthStore).mustChangePassword() || pathOf(state.url) === CHANGE_PASSWORD) return true;
  return inject(Router).createUrlTree([CHANGE_PASSWORD], { queryParams: { returnUrl: state.url } });
};

/** For /login: an already signed-in user is sent home. */
export const anonymousGuard: CanActivateFn = () =>
  inject(AuthStore).isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
