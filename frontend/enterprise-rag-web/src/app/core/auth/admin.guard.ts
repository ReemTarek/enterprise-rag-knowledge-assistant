import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/** Global admins only (UX gate; the API enforces the role). */
export const adminGuard: CanActivateFn = () =>
  inject(AuthStore).isAdmin() ? true : inject(Router).createUrlTree(['/forbidden']);
