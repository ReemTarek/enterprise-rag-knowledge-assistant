import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Observable, filter, switchMap } from 'rxjs';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog/confirm-dialog';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { DirectoryUser } from '../../../shared/user-picker/directory-user';
import { UserPicker } from '../../../shared/user-picker/user-picker';
import { KbApi } from '../kb.api';
import { KB_ROLES, KbMember, KbRole } from '../kb.models';

/**
 * Members of one knowledge base. Everyone who can see the KB sees the list; only owners get controls (the server
 * enforces this too). Every membership mutation emits `membershipChanged` so the host can re-read the KB: the server
 * touches the KB row on membership changes, which changes its ETag.
 */
@Component({
  selector: 'app-kb-members',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    TranslocoPipe,
    ErrorBanner,
    UserPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kb-members.scss',
  templateUrl: './kb-members.html',
})
export class KbMembers implements OnInit {
  readonly kbId = input.required<string>();
  readonly canManage = input(false);
  readonly membershipChanged = output<void>();

  private readonly api = inject(KbApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly picker = viewChild(UserPicker);

  protected readonly roles = KB_ROLES;
  protected readonly members = signal<KbMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly pending = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly correlationId = signal<string | undefined>(undefined);
  protected readonly picked = signal<DirectoryUser | null>(null);
  protected readonly newRole = new FormControl<KbRole>('Viewer', { nonNullable: true });
  protected readonly memberIds = computed(() => this.members().map((m) => m.userId));
  protected readonly search = (q: string): Observable<DirectoryUser[]> => this.api.searchUsers(q);

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.api.members(this.kbId()).subscribe({
      next: (list) => {
        this.members.set(list);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.fail(e);
      },
    });
  }

  protected add(): void {
    const user = this.picked();
    if (!user || this.pending()) return;
    this.begin();
    this.api.addMember(this.kbId(), user.id, this.newRole.value).subscribe({
      next: () => {
        this.picker()?.reset();
        this.picked.set(null);
        this.newRole.setValue('Viewer');
        this.done('kb.members.added');
      },
      error: (e: unknown) => {
        this.pending.set(false);
        this.fail(e, { 404: 'kb.members.userNotFound', 409: 'kb.members.alreadyMember' });
      },
    });
  }

  protected changeRole(member: KbMember, event: MatSelectChange): void {
    const role = event.value as KbRole;
    if (role === member.role || this.pending()) return;
    this.begin();
    this.api.changeRole(this.kbId(), member.userId, role).subscribe({
      next: () => this.done(null),
      error: (e: unknown) => {
        this.pending.set(false);
        event.source.value = member.role; // show the server's state again
        this.fail(e, { 404: 'kb.members.notAMember', 409: 'kb.members.lastOwner' });
        if (asApiError(e)?.status === 404) this.reload();
      },
    });
  }

  protected remove(member: KbMember): void {
    if (this.pending()) return;
    const data: ConfirmDialogData = {
      title: this.transloco.translate('kb.members.removeTitle'),
      message: this.transloco.translate('kb.members.removeMessage', { name: member.displayName }),
      confirmLabel: this.transloco.translate('kb.members.remove'),
    };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data })
      .afterClosed()
      .pipe(
        filter((ok) => ok === true),
        switchMap(() => {
          this.begin();
          return this.api.removeMember(this.kbId(), member.userId);
        }),
      )
      .subscribe({
        next: () => this.done('kb.members.removed'),
        error: (e: unknown) => {
          this.pending.set(false);
          this.fail(e, { 404: 'kb.members.notAMember', 409: 'kb.members.lastOwner' });
          if (asApiError(e)?.status === 404) this.reload();
        },
      });
  }

  private begin(): void {
    this.pending.set(true);
    this.errorKey.set(null);
    this.correlationId.set(undefined);
  }

  private done(messageKey: string | null): void {
    this.pending.set(false);
    if (messageKey)
      this.snack.open(this.transloco.translate(messageKey), undefined, { duration: 4000 });
    this.reload();
    this.membershipChanged.emit();
  }

  private fail(e: unknown, byStatus: Record<number, string> = {}): void {
    const err = asApiError(e);
    this.errorKey.set(
      (err && byStatus[err.status]) ?? (err ? messageKeyFor(err) : 'errors.generic'),
    );
    this.correlationId.set(err ? correlationIdFor(err) : undefined);
  }
}
