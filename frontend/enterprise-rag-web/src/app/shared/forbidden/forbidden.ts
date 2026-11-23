import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h1>{{ 'forbidden.heading' | transloco }}</h1>
      <p>{{ 'forbidden.body' | transloco }}</p>
      <a routerLink="/">{{ 'forbidden.home' | transloco }}</a>
    </section>
  `,
})
export class Forbidden {}
