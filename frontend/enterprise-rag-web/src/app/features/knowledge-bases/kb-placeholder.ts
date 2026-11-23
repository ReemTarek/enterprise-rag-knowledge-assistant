import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Replaced by the real knowledge-base pages in the next task. */
@Component({
  selector: 'app-kb-placeholder',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'kb.title' | transloco }}</h1>
    <p>{{ 'kb.placeholder' | transloco }}</p>
  `,
})
export class KbPlaceholder {}
