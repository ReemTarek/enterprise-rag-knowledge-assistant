import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Input of the dialog. `password` is blanked by the dialog as soon as it has taken its own copy, so the
 * (long-lived) dialog config no longer references the secret.
 */
export interface TempPasswordDialogData {
  email: string;
  displayName: string;
  password: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Shows a one-time temporary password. Security-critical: the password lives only in this component's signal,
 * is never written to storage/URL/console, and is nulled on close/destroy.
 */
@Component({
  selector: 'app-temp-password-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .who {
      margin-block-end: 12px;
      overflow-wrap: anywhere;
    }
    .warning {
      padding-block: 8px;
      padding-inline: 12px;
      border-radius: 8px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .field {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-block: 16px 8px;
    }
    .field label {
      inline-size: 100%;
      font: var(--mat-sys-label-large);
    }
    .password {
      flex: 1 1 16ch;
      min-inline-size: 0;
      padding-block: 10px;
      padding-inline: 12px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
      font-size: 1.1rem;
      text-align: start;
    }
    .status {
      min-block-size: 1.5em;
      margin: 0;
      font: var(--mat-sys-body-small);
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ 'admin.tempPassword.title' | transloco }}</h2>
    <mat-dialog-content>
      <p class="who">
        <strong
          ><bdi>{{ data.displayName }}</bdi></strong
        >
        (<bdi dir="ltr">{{ data.email }}</bdi
        >)
      </p>
      <p class="warning" data-testid="warning">{{ 'admin.tempPassword.warning' | transloco }}</p>
      <div class="field">
        <label for="temp-password">{{ 'admin.tempPassword.label' | transloco }}</label>
        <input
          id="temp-password"
          class="password"
          type="text"
          dir="ltr"
          readonly
          autocomplete="off"
          spellcheck="false"
          data-testid="password-field"
          [value]="password() ?? ''"
        />
        <button mat-stroked-button type="button" data-testid="copy" (click)="copy()">
          {{ 'common.copy' | transloco }}
        </button>
      </div>
      <p class="status" role="status" aria-live="polite" data-testid="copy-status">
        @switch (copyState()) {
          @case ('copied') {
            {{ 'admin.tempPassword.copied' | transloco }}
          }
          @case ('failed') {
            {{ 'admin.tempPassword.copyFailed' | transloco }}
          }
        }
      </p>
      <mat-checkbox
        data-testid="ack"
        [checked]="acknowledged()"
        (change)="acknowledged.set($event.checked)"
      >
        {{ 'admin.tempPassword.acknowledge' | transloco }}
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-flat-button
        type="button"
        data-testid="close"
        [disabled]="!acknowledged()"
        (click)="close()"
      >
        {{ 'common.close' | transloco }}
      </button>
    </mat-dialog-actions>
  `,
})
export class TempPasswordDialog {
  protected readonly data = inject<TempPasswordDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<TempPasswordDialog, void>>(MatDialogRef);

  /** Public readonly only so tests can assert it is nulled; never log or persist it. */
  readonly password = signal<string | null>(null);
  protected readonly acknowledged = signal(false);
  protected readonly copyState = signal<CopyState>('idle');

  constructor() {
    this.password.set(this.data.password);
    this.data.password = '';
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  protected async copy(): Promise<void> {
    const value = this.password();
    if (value === null) return;
    try {
      await navigator.clipboard.writeText(value);
      this.copyState.set('copied');
    } catch {
      // Clipboard unavailable or denied: ask the user to copy it by hand. Never rethrow or log.
      this.copyState.set('failed');
    }
  }

  protected close(): void {
    if (!this.acknowledged()) return;
    this.clear();
    this.ref.close();
  }

  private clear(): void {
    this.password.set(null);
    this.data.password = '';
  }
}
