import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { LanguageSwitcher } from '../../../shared/language-switcher/language-switcher';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoPipe,
    ErrorBanner,
    LanguageSwitcher,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly banner = viewChild(ErrorBanner);
  private readonly formDirective = viewChild(FormGroupDirective);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
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
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => this.onSuccess(),
      error: (e: unknown) => this.onError(e),
    });
  }

  private onSuccess(): void {
    const returnUrl = sanitizeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    if (this.store.mustChangePassword()) {
      const queryParams = returnUrl === '/' ? {} : { returnUrl };
      void this.router.navigateByUrl(
        this.router.createUrlTree(['/change-password'], { queryParams }),
      );
    } else {
      void this.router.navigateByUrl(returnUrl);
    }
  }

  private onError(error: unknown): void {
    this.pending.set(false);
    // resetForm also clears the "submitted" state, so no field error flashes for the emptied password.
    this.formDirective()?.resetForm({ email: this.form.controls.email.value, password: '' });
    const status = error instanceof ApiError ? error.status : 0;
    this.correlationId.set(undefined);
    if (status === 401) {
      this.errorKey.set('login.error.invalid');
    } else if (status === 429) {
      this.errorKey.set('login.error.rateLimited');
    } else {
      this.errorKey.set(status === 0 ? 'errors.network' : 'errors.generic');
      this.correlationId.set(error instanceof ApiError ? error.correlationId : undefined);
    }
    afterNextRender(() => this.banner()?.focus(), { injector: this.injector });
  }
}
