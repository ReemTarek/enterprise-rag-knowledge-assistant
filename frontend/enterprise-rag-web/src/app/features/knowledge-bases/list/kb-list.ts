import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { asApiError, correlationIdFor, messageKeyFor } from '../../../core/api/error-message';
import '../../../core/i18n/locale-data';
import { LanguageService } from '../../../core/i18n/language.service';
import { ErrorBanner } from '../../../shared/error-banner/error-banner';
import { TranslatedPaginatorIntl } from '../../../shared/translated-paginator-intl';
import { KbCreateDialog } from '../create-dialog/kb-create-dialog';
import { KbApi } from '../kb.api';
import { KnowledgeBase, KnowledgeBaseSummary } from '../kb.models';

type ListState = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-kb-list',
  imports: [
    DatePipe,
    MatButtonModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
    RouterLink,
    TranslocoPipe,
    ErrorBanner,
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kb-list.scss',
  templateUrl: './kb-list.html',
})
export class KbList {
  private readonly api = inject(KbApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly lang = inject(LanguageService).current;

  protected readonly columns = ['name', 'description', 'role', 'updated'];
  protected readonly pageSizes = [10, 25, 50];
  protected readonly state = signal<ListState>('loading');
  protected readonly items = signal<KnowledgeBaseSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly errorKey = signal('errors.generic');
  protected readonly correlationId = signal<string | undefined>(undefined);
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

  protected open(kb: KnowledgeBase): void {
    void this.router.navigate(['/knowledge-bases', kb.id]);
  }

  protected create(): void {
    this.dialog
      .open<KbCreateDialog, undefined, KnowledgeBase>(KbCreateDialog, {
        width: '520px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((kb) => {
        if (kb) this.open(kb);
      });
  }
}
