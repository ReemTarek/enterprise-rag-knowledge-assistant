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
  FormGroupDirective,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthStore } from '../../../core/auth/auth.store';
import { sanitizeReturnUrl } from '../../../core/navigation/safe-return-url';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Mirrors the server policy (SECURITY.md); the server stays the authority. */
export const passwordPolicy: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = control.value as string;
  if (!v) return null;
  const errors: ValidationErrors = {};
  if (v.length < MIN_PASSWORD_LENGTH) errors['minLength'] = true;
  if (v.length > MAX_PASSWORD_LENGTH) errors['maxLength'] = true;
  // ASCII classes on purpose: the server checks [A-Z], [a-z], [0-9]; Ä/ß/Arabic-Indic digits must not pass here.
  if (!/[A-Z]/.test(v)) errors['upper'] = true;
  if (!/[a-z]/.test(v)) errors['lower'] = true;
  if (!/[0-9]/.test(v)) errors['digit'] = true;
  return Object.keys(errors).length > 0 ? errors : null;
};

const crossFieldRules: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const current = group.get('currentPassword')?.value as string;
  const next = group.get('newPassword')?.value as string;
  const confirm = group.get('confirmPassword')?.value as string;
  const errors: ValidationErrors = {};
  if (confirm && next !== confirm) errors['mismatch'] = true;
  if (next && current && next === current) errors['sameAsCurrent'] = true;
  return Object.keys(errors).length > 0 ? errors : null;
};

const POLICY_KEYS = ['minLength', 'maxLength', 'upper', 'lower', 'digit'] as const;

@Component({
  selector: 'app-change-password',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoPipe,
    ErrorBanner,
  ],
  templateUrl: './change-password.html',
  styleUrl: './change-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePassword {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly banner = viewChild(ErrorBanner);
  private readonly formDirective = viewChild(FormGroupDirective);

  protected readonly store = inject(AuthStore);
  protected readonly policyKeys = POLICY_KEYS;
  protected readonly form = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, passwordPolicy]],
      confirmPassword: ['', Validators.required],
    },
    { validators: crossFieldRules },
  );
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
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.auth.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        const returnUrl = sanitizeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
        void this.router.navigateByUrl(returnUrl);
      },
      error: (e: unknown) => this.onError(e),
    });
  }

  private onError(error: unknown): void {
    this.pending.set(false);
    this.formDirective()?.resetForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const api = error instanceof ApiError ? error : null;
    this.correlationId.set(undefined);
    if (api?.status === 429) {
      this.errorKey.set('changePassword.error.rateLimited');
    } else if (api?.status === 400) {
      // Never echo server-provided values: one generic, translated message.
      this.errorKey.set('changePassword.error.rejected');
      this.correlationId.set(api.correlationId);
    } else {
      this.errorKey.set(api && api.status !== 0 ? 'errors.generic' : 'errors.network');
      this.correlationId.set(api?.correlationId);
    }
    afterNextRender(() => this.banner()?.focus(), { injector: this.injector });
  }
}
