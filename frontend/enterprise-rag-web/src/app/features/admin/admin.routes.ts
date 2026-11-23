import { Routes } from '@angular/router';

/** Mounted at `admin` behind adminGuard (see app.routes.ts). `title` values are translation keys. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  {
    path: 'users',
    title: 'title.adminUsers',
    loadComponent: () => import('./users/users').then((m) => m.Users),
  },
];
