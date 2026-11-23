import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';
import { authGuard } from './core/auth/auth.guard';
import { anonymousGuard, mustChangeGuard } from './core/auth/must-change.guard';
import { Shell } from './layout/shell/shell';

/** `title` values are translation keys, resolved by AppTitleStrategy. */
export const routes: Routes = [
  {
    path: 'login',
    title: 'title.login',
    canActivate: [anonymousGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    // Everything behind sign-in. mustChangeGuard covers every child, so no page is reachable while a change is due.
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [mustChangeGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'knowledge-bases' },
      {
        path: 'change-password',
        title: 'title.changePassword',
        loadComponent: () =>
          import('./features/auth/change-password/change-password').then((m) => m.ChangePassword),
      },
      {
        path: 'knowledge-bases',
        loadChildren: () => import('./features/knowledge-bases/kb.routes').then((m) => m.KB_ROUTES),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        path: 'settings',
        title: 'title.settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'forbidden',
        title: 'title.forbidden',
        loadComponent: () => import('./shared/forbidden/forbidden').then((m) => m.Forbidden),
      },
      {
        path: '**',
        title: 'title.notFound',
        loadComponent: () => import('./shared/not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
];
