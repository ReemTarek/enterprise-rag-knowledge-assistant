import { Injectable, inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';

/** Paginator labels from the active Transloco language (provide per component: `{ provide: MatPaginatorIntl, useClass: ... }`). */
@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
  private readonly transloco = inject(TranslocoService);

  constructor() {
    super();
    this.update();
    merge(
      this.transloco.langChanges$,
      this.transloco.events$.pipe(filter((e) => e.type === 'translationLoadSuccess')),
    ).subscribe(() => this.update());
  }

  private update(): void {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    this.itemsPerPageLabel = t('kb.paginator.itemsPerPage');
    this.nextPageLabel = t('kb.paginator.next');
    this.previousPageLabel = t('kb.paginator.previous');
    this.firstPageLabel = t('kb.paginator.first');
    this.lastPageLabel = t('kb.paginator.last');
    this.getRangeLabel = (page, pageSize, length) => {
      if (length === 0) return t('kb.paginator.rangeEmpty', { total: length });
      const start = page * pageSize;
      const end = Math.min(start + pageSize, length);
      return t('kb.paginator.range', { start: start + 1, end, total: length });
    };
    this.changes.next();
  }
}
