import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Replaced by the real administration pages in a later task. */
@Component({
  selector: 'app-admin-placeholder',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'admin.title' | transloco }}</h1>
    <p>{{ 'admin.placeholder' | transloco }}</p>
  `,
})
export class AdminPlaceholder {}
