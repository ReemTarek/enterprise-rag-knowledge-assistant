import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoPipe } from '@jsverse/transloco';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { UsersApi } from '../users.api';
import {
  CreatedUserResult,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  GLOBAL_ROLES,
  GlobalRole,
} from '../users.models';

/** Whitespace-only values are invalid (the value is trimmed before it is sent). */
function notBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim().length === 0 ? { required: true } : null;
}

/** Creates a user; closes with the API result (the opener shows the temporary password). */
@Component({
  selector: 'app-create-user-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
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
    <h2 mat-dialog-title>{{ 'admin.users.create.title' | transloco }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <mat-form-field>
          <mat-label>{{ 'admin.users.create.email' | transloco }}</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="off" required />
          @if (form.controls.email.hasError('required')) {
            <mat-error>{{ 'admin.users.validation.emailRequired' | transloco }}</mat-error>
          } @else if (form.controls.email.hasError('email')) {
            <mat-error>{{ 'admin.users.validation.emailInvalid' | transloco }}</mat-error>
          } @else if (form.controls.email.hasError('maxlength')) {
            <mat-error>{{ 'admin.users.validation.emailMaxLength' | transloco }}</mat-error>
          } @else if (form.controls.email.hasError('duplicate')) {
            <mat-error data-testid="duplicate-email">{{
              'admin.users.validation.emailDuplicate' | transloco
            }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'admin.users.create.displayName' | transloco }}</mat-label>
          <input matInput formControlName="displayName" autocomplete="off" required />
          @if (form.controls.displayName.hasError('required')) {
            <mat-error>{{ 'admin.users.validation.nameRequired' | transloco }}</mat-error>
          } @else if (form.controls.displayName.hasError('maxlength')) {
            <mat-error>{{ 'admin.users.validation.nameMaxLength' | transloco }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'admin.users.create.role' | transloco }}</mat-label>
          <mat-select formControlName="globalRole">
            @for (role of roles; track role) {
              <mat-option [value]="role">{{ 'admin.role.' + role | transloco }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (errorKey(); as key) {
          <app-error-banner [messageKey]="key" [correlationId]="correlationId()" />
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button
          mat-button
          type="button"
          data-testid="cancel"
          [disabled]="pending()"
          (click)="ref.close()"
        >
          {{ 'common.cancel' | transloco }}
        </button>
        <button mat-flat-button type="submit" data-testid="submit" [disabled]="pending()">
          {{ 'admin.users.create.submit' | transloco }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class CreateUserDialog {
  private readonly api = inject(UsersApi);
  protected readonly ref = inject<MatDialogRef<CreateUserDialog, CreatedUserResult>>(MatDialogRef);
  private readonly injector = inject(Injector);
  private readonly banner = viewChild(ErrorBanner);

  protected readonly roles = GLOBAL_ROLES;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(EMAIL_MAX_LENGTH)]],
    displayName: ['', [notBlank, Validators.maxLength(DISPLAY_NAME_MAX_LENGTH)]],
    globalRole: ['User' as GlobalRole],
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
    this.setPending(true);
    this.errorKey.set(null);
    const { email, displayName, globalRole } = this.form.getRawValue();
    this.api
      .create({ email: email.trim(), displayName: displayName.trim(), globalRole })
      .subscribe({
        next: (created) => {
          this.setPending(false);
          this.ref.close({ ...created, displayName: displayName.trim() });
        },
        error: (e: unknown) => this.onError(e),
      });
  }

  /** Escape / backdrop dismissal is blocked while the request is in flight (`disableClose` follows `pending`). */
  private setPending(value: boolean): void {
    this.pending.set(value);
    this.ref.disableClose = value;
  }

  private onError(e: unknown): void {
    this.setPending(false);
    const err = asApiError(e);
    this.correlationId.set(err ? correlationIdFor(err) : undefined);
    if (err?.status === 409) {
      const control = this.form.controls.email;
      control.setErrors({ duplicate: true });
      control.markAsTouched();
      this.errorKey.set(null);
      return;
    }
    // 400 and everything else: a generic translated message; server text is never echoed.
    this.errorKey.set(
      err?.status === 400 ? 'errors.validation' : err ? messageKeyFor(err) : 'errors.generic',
    );
    afterNextRender(() => this.banner()?.focus(), { injector: this.injector });
  }
}
