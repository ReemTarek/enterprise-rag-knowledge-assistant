import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Error message region: announced by screen readers (role=alert) and focusable so a failed submit can move focus here. */
@Component({
  selector: 'app-error-banner',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .banner {
      padding-block: 12px;
      padding-inline: 16px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .banner:focus-visible {
      outline: 2px solid var(--mat-sys-error);
      outline-offset: 2px;
    }
    .ref {
      margin-block: 4px 0;
      font: var(--mat-sys-body-small);
    }
  `,
  template: `
    <div #box class="banner" role="alert" tabindex="-1">
      <div>{{ messageKey() | transloco }}</div>
      @if (correlationId(); as id) {
        <p class="ref">{{ 'errors.correlationId' | transloco: { id } }}</p>
      }
    </div>
  `,
})
export class ErrorBanner {
  readonly messageKey = input.required<string>();
  readonly correlationId = input<string | undefined>();
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  focus(): void {
    this.box().nativeElement.focus();
  }
}
