import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { KbApi } from '../kb.api';
import { DESCRIPTION_MAX_LENGTH, KnowledgeBase, NAME_MAX_LENGTH } from '../kb.models';

/** Creates a knowledge base; closes with the created KB (the opener navigates to it). */
@Component({
  selector: 'app-kb-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoPipe,
    ErrorBanner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form {
      display: flex;
      flex-direction: column;
    }
    mat-form-field {
      inline-size: 100%;
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ 'kb.create.title' | transloco }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field>
          <mat-label>{{ 'kb.create.name' | transloco }}</mat-label>
          <input matInput formControlName="name" autocomplete="off" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>{{ 'kb.validation.nameRequired' | transloco }}</mat-error>
          } @else if (form.controls.name.hasError('maxlength')) {
            <mat-error>{{ 'kb.validation.nameMaxLength' | transloco }}</mat-error>
          } @else if (form.controls.name.hasError('server')) {
            <mat-error>{{ 'kb.validation.server' | transloco }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'kb.create.description' | transloco }}</mat-label>
          <textarea matInput formControlName="description" rows="4"></textarea>
          @if (form.controls.description.hasError('maxlength')) {
            <mat-error>{{ 'kb.validation.descriptionMaxLength' | transloco }}</mat-error>
          } @else if (form.controls.description.hasError('server')) {
            <mat-error>{{ 'kb.validation.server' | transloco }}</mat-error>
          }
        </mat-form-field>
        @if (errorKey(); as key) {
          <app-error-banner [messageKey]="key" [correlationId]="correlationId()" />
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | transloco }}</button>
        <button mat-flat-button type="submit" [disabled]="pending()">
          {{ 'kb.create.submit' | transloco }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class KbCreateDialog {
  private readonly api = inject(KbApi);
  private readonly ref = inject<MatDialogRef<KbCreateDialog, KnowledgeBase>>(MatDialogRef);
  private readonly injector = inject(Injector);
  private readonly banner = viewChild(ErrorBanner);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(NAME_MAX_LENGTH)]],
    description: ['', [Validators.maxLength(DESCRIPTION_MAX_LENGTH)]],
  });
  protected readonly pending = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly correlationId = signal<string | undefined>(undefined);

  protected submit(): void {
    if (this.pending()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.errorKey.set(null);
    const { name, description } = this.form.getRawValue();
    this.api.create({ name: name.trim(), description: description.trim() || null }).subscribe({
      next: ({ kb }) => this.ref.close(kb),
      error: (e: unknown) => this.onError(e),
    });
  }

  private onError(e: unknown): void {
    this.pending.set(false);
    const api = asApiError(e);
    this.correlationId.set(api ? correlationIdFor(api) : undefined);
    // Server field messages are never shown (they are untranslated); only the fact that a field was rejected.
    let matched = false;
    for (const field of Object.keys(api?.errors ?? {})) {
      const control = this.form.get(field.charAt(0).toLowerCase() + field.slice(1));
      if (control) {
        control.setErrors({ server: true });
        control.markAsTouched();
        matched = true;
      }
    }
    this.errorKey.set(matched ? null : api ? messageKeyFor(api) : 'errors.generic');
    afterNextRender(() => this.banner()?.focus(), { injector: this.injector });
  }
}
