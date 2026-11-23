import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subscription, filter, switchMap } from 'rxjs';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import '../../../core/i18n/locale-data';
import { LanguageService } from '../../../core/i18n/language.service';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog/confirm-dialog';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { NotFound } from '../../../shared/not-found/not-found';
import { notBlank } from '../../../shared/validators/not-blank';
import { KbApi } from '../kb.api';
import { DESCRIPTION_MAX_LENGTH, KnowledgeBase, NAME_MAX_LENGTH } from '../kb.models';
import { KbMembers } from '../members/kb-members';

type DetailState = 'loading' | 'ready' | 'notFound' | 'error';
/** Why the user must reload: the KB changed elsewhere (412) or the version header was missing (428). */
type ConflictKind = 'changed' | 'required';

@Component({
  selector: 'app-kb-detail',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    RouterLink,
    TranslocoPipe,
    ErrorBanner,
    NotFound,
    KbMembers,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kb-detail.scss',
  templateUrl: './kb-detail.html',
})
export class KbDetail {
  private readonly api = inject(KbApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly lang = inject(LanguageService).current;

  protected readonly state = signal<DetailState>('loading');
  protected readonly kb = signal<KnowledgeBase | null>(null);
  /** Raw ETag of the loaded version; sent as If-Match on update. */
  private etag = '';
  protected readonly editing = signal(false);
  protected readonly pending = signal(false);
  protected readonly conflict = signal<ConflictKind | null>(null);
  /** Set when the server answered 403: the user's role is lower than the UI assumed; owner actions go away. */
  protected readonly denied = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly correlationId = signal<string | undefined>(undefined);
  protected readonly canOwn = computed(() => this.kb()?.myRole === 'Owner' && !this.denied());

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [notBlank, Validators.maxLength(NAME_MAX_LENGTH)]],
    description: ['', [Validators.maxLength(DESCRIPTION_MAX_LENGTH)]],
  });

  private request?: Subscription;
  private id = '';

  constructor() {
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.id = p.get('id') ?? '';
      this.reset();
      this.load();
    });
  }

  private reset(): void {
    this.kb.set(null);
    this.etag = '';
    this.editing.set(false);
    this.conflict.set(null);
    this.denied.set(false);
    this.errorKey.set(null);
    this.pending.set(false);
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.state.set('loading');
    this.request = this.api.get(this.id).subscribe({
      next: (r) => {
        this.adopt(r.kb, r.etag);
        this.state.set('ready');
      },
      error: (e: unknown) => this.onLoadError(e),
    });
  }

  /** Re-GET after the user chose "Reload" in the conflict banner; keeps the edit form open on the fresh values. */
  protected reload(): void {
    this.errorKey.set(null);
    this.api.get(this.id).subscribe({
      next: (r) => {
        this.adopt(r.kb, r.etag);
        this.conflict.set(null);
      },
      error: (e: unknown) => this.onLoadError(e),
    });
  }

  private onLoadError(e: unknown): void {
    const err = asApiError(e);
    // Unknown, forbidden and deleted are deliberately the same page: the server answers them identically.
    if (err && (err.status === 404 || err.status === 403)) {
      this.kb.set(null);
      this.state.set('notFound');
      return;
    }
    this.errorKey.set(err ? messageKeyFor(err) : 'errors.generic');
    this.correlationId.set(err ? correlationIdFor(err) : undefined);
    this.state.set('error');
  }

  private adopt(kb: KnowledgeBase, etag: string): void {
    this.kb.set(kb);
    this.etag = etag;
    this.form.reset({ name: kb.name, description: kb.description ?? '' });
  }

  protected startEdit(): void {
    const kb = this.kb();
    if (!kb) return;
    this.form.reset({ name: kb.name, description: kb.description ?? '' });
    this.errorKey.set(null);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.conflict.set(null);
    this.errorKey.set(null);
  }

  protected save(): void {
    if (this.pending() || !this.canOwn()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, description } = this.form.getRawValue();
    this.pending.set(true);
    this.errorKey.set(null);
    this.conflict.set(null);
    this.api
      .update(this.id, { name: name.trim(), description: description.trim() || null }, this.etag)
      .subscribe({
        next: (r) => {
          this.pending.set(false);
          this.adopt(r.kb, r.etag);
          this.editing.set(false);
          this.snack.open(this.transloco.translate('kb.detail.saved'), undefined, {
            duration: 3000,
          });
        },
        error: (e: unknown) => {
          this.pending.set(false);
          this.onSaveError(e);
        },
      });
  }

  private onSaveError(e: unknown): void {
    const err = asApiError(e);
    switch (err?.status) {
      case 412:
        this.conflict.set('changed');
        return;
      case 428:
        this.conflict.set('required');
        return;
      case 404:
        this.state.set('notFound');
        return;
      case 403:
        this.denied.set(true);
        this.editing.set(false);
        this.errorKey.set('errors.forbidden');
        return;
      default:
        this.errorKey.set(err ? messageKeyFor(err) : 'errors.generic');
        this.correlationId.set(err ? correlationIdFor(err) : undefined);
    }
  }

  protected delete(): void {
    const kb = this.kb();
    if (!kb || this.pending() || !this.canOwn()) return;
    const data: ConfirmDialogData = {
      title: this.transloco.translate('kb.detail.deleteTitle'),
      message: this.transloco.translate('kb.detail.deleteMessage', { name: kb.name }),
      confirmLabel: this.transloco.translate('common.delete'),
    };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data })
      .afterClosed()
      .pipe(
        filter((ok) => ok === true),
        switchMap(() => {
          this.pending.set(true);
          this.errorKey.set(null);
          return this.api.delete(this.id);
        }),
      )
      .subscribe({
        next: () => {
          this.snack.open(this.transloco.translate('kb.detail.deleted'), undefined, {
            duration: 4000,
          });
          void this.router.navigate(['/knowledge-bases']);
        },
        error: (e: unknown) => {
          this.pending.set(false);
          this.onSaveError(e);
        },
      });
  }

  /**
   * Membership changes touch the KB row, so its ETag moved. Re-read it quietly. If someone else also renamed the KB
   * while we are editing, keep the old ETag and raise the conflict banner so a save cannot overwrite their change.
   */
  protected refreshAfterMembership(): void {
    this.api.get(this.id).subscribe({
      next: (r) => {
        const current = this.kb();
        if (
          this.editing() &&
          current &&
          (r.kb.name !== current.name || r.kb.description !== current.description)
        ) {
          this.conflict.set('changed');
          return;
        }
        this.kb.set(r.kb);
        this.etag = r.etag;
        if (!this.editing())
          this.form.reset({ name: r.kb.name, description: r.kb.description ?? '' });
      },
      error: (e: unknown) => {
        const err = asApiError(e);
        // e.g. the caller just removed themselves: the KB is no longer visible.
        if (err && (err.status === 404 || err.status === 403)) this.state.set('notFound');
      },
    });
  }
}
