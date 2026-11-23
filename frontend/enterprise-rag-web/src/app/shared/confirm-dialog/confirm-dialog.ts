import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';

/** Already-translated texts: the caller translates, so the dialog stays generic. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  /** Defaults to the translated `common.confirm`. */
  confirmLabel?: string;
}

/** Closes with `true` when confirmed, `false` otherwise. Cancel takes initial focus so Enter is never destructive. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        cdkFocusInitial
        (click)="ref.close(false)"
        data-testid="confirm-no"
      >
        {{ 'common.cancel' | transloco }}
      </button>
      <button mat-flat-button type="button" (click)="ref.close(true)" data-testid="confirm-yes">
        {{ data.confirmLabel ?? ('common.confirm' | transloco) }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialog {
  protected readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
