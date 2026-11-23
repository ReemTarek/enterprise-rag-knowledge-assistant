import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/** Authenticated users only; anonymous users go to /login with the wanted URL as `returnUrl`. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthStore).isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
