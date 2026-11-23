import { Routes } from '@angular/router';

/** Mounted at `knowledge-bases` (see app.routes.ts). `title` values are translation keys. */
export const KB_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'title.knowledgeBases',
    loadComponent: () => import('./list/kb-list').then((m) => m.KbList),
  },
  {
    path: ':id',
    title: 'title.knowledgeBases',
    loadComponent: () => import('./detail/kb-detail').then((m) => m.KbDetail),
  },
];
