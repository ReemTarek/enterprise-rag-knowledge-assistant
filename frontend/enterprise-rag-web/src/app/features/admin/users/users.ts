import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Observable, Subscription, filter, finalize, switchMap } from 'rxjs';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import { AuthStore } from '../../../core/auth/auth.store';
import '../../../core/i18n/locale-data';
import { LanguageService } from '../../../core/i18n/language.service';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/confirm-dialog/confirm-dialog';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { TranslatedPaginatorIntl } from '../../../shared/translated-paginator-intl';
import { CreateUserDialog } from '../create-user-dialog/create-user-dialog';
import {
  TempPasswordDialog,
  TempPasswordDialogData,
} from '../temp-password-dialog/temp-password-dialog';
import { UsersApi } from '../users.api';
import { AdminUser, CreatedUserResult } from '../users.models';

type ListState = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-admin-users',
  imports: [
    DatePipe,
    MatButtonModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
    TranslocoPipe,
    ErrorBanner,
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './users.scss',
  templateUrl: './users.html',
})
export class Users {
  private readonly api = inject(UsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly lang = inject(LanguageService).current;
  private readonly auth = inject(AuthStore);

  protected readonly columns = [
    'displayName',
    'email',
    'role',
    'active',
    'lockout',
    'mustChange',
    'actions',
  ];
  protected readonly pageSizes = [10, 25, 50];
  protected readonly state = signal<ListState>('loading');
  protected readonly items = signal<AdminUser[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly errorKey = signal('errors.generic');
  protected readonly correlationId = signal<string | undefined>(undefined);
  /** Error from a row action (deactivate / reset), shown above the table. */
  protected readonly actionErrorKey = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly currentUserId = () => this.auth.user()?.id ?? null;
  private request?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
    this.load();
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.state.set('loading');
    this.request = this.api.list(this.pageIndex() + 1, this.pageSize()).subscribe({
      next: (paged) => {
        this.items.set(paged.items);
        this.total.set(paged.totalCount);
        this.state.set('ready');
      },
      error: (e: unknown) => {
        const err = asApiError(e);
        this.errorKey.set(err ? messageKeyFor(err) : 'errors.generic');
        this.correlationId.set(err ? correlationIdFor(err) : undefined);
        this.state.set('error');
      },
    });
  }

  protected onPage(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.load();
  }

  protected create(): void {
    this.actionErrorKey.set(null);
    this.dialog
      .open<CreateUserDialog, undefined, CreatedUserResult>(CreateUserDialog, {
        width: '520px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .pipe(filter((created): created is CreatedUserResult => !!created))
      .subscribe((created) => {
        this.showTemporaryPassword(created.displayName, created.email, created.temporaryPassword);
        this.load();
      });
  }

  protected deactivate(user: AdminUser): void {
    this.confirm(
      this.transloco.translate('admin.users.deactivateTitle'),
      this.transloco.translate('admin.users.deactivateMessage', { name: user.displayName }),
      this.transloco.translate('admin.users.deactivate'),
    )
      .pipe(switchMap(() => this.run(this.api.deactivate(user.id))))
      .subscribe({
        next: () => this.load(),
        error: (e: unknown) => this.onActionError(e, true),
      });
  }

  protected resetPassword(user: AdminUser): void {
    this.confirm(
      this.transloco.translate('admin.users.resetTitle'),
      this.transloco.translate('admin.users.resetMessage', { name: user.displayName }),
      this.transloco.translate('admin.users.resetPassword'),
    )
      .pipe(switchMap(() => this.run(this.api.resetPassword(user.id))))
      .subscribe({
        next: (result) => {
          this.showTemporaryPassword(user.displayName, user.email, result.temporaryPassword);
          this.load();
        },
        error: (e: unknown) => this.onActionError(e, false),
      });
  }

  private confirm(title: string, message: string, confirmLabel: string): Observable<boolean> {
    this.actionErrorKey.set(null);
    const data: ConfirmDialogData = { title, message, confirmLabel };
    return this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data })
      .afterClosed()
      .pipe(filter((ok): ok is true => ok === true));
  }

  private run<T>(call: Observable<T>): Observable<T> {
    this.busy.set(true);
    return call.pipe(finalize(() => this.busy.set(false)));
  }

  private onActionError(e: unknown, isDeactivate: boolean): void {
    const err = asApiError(e);
    this.actionErrorKey.set(
      isDeactivate && err?.status === 409
        ? 'admin.users.cannotDeactivateSelf'
        : err
          ? messageKeyFor(err)
          : 'errors.generic',
    );
  }

  private showTemporaryPassword(displayName: string, email: string, password: string): void {
    const data: TempPasswordDialogData = { displayName, email, password };
    this.dialog.open<TempPasswordDialog, TempPasswordDialogData, void>(TempPasswordDialog, {
      data,
      disableClose: true,
      width: '520px',
      maxWidth: '95vw',
    });
  }
}
