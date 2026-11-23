import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h1>{{ 'notFound.heading' | transloco }}</h1>
      <p>{{ 'notFound.body' | transloco }}</p>
      <a routerLink="/">{{ 'notFound.home' | transloco }}</a>
    </section>
  `,
})
export class NotFound {}
