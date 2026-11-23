import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { provideI18nTesting } from '../core/i18n/i18n.testing';
import { TranslatedPaginatorIntl } from './translated-paginator-intl';

/** Provides the intl per component, exactly like the list pages do. */
@Component({
  selector: 'app-paginator-host',
  template: '',
  providers: [{ provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl }],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PaginatorHost {
  readonly intl = inject(MatPaginatorIntl);
}

describe('TranslatedPaginatorIntl', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideI18nTesting()] });
    const transloco = TestBed.inject(TranslocoService);
    await firstValueFrom(transloco.load('en'));
    await firstValueFrom(transloco.load('de'));
  });
  afterEach(() => TestBed.inject(TranslocoService).setActiveLang('en'));

  it('PaginatorIntl_FollowsLanguage_WhileHostIsAlive', async () => {
    const f = TestBed.createComponent(PaginatorHost);
    const intl = f.componentInstance.intl;
    const transloco = TestBed.inject(TranslocoService);
    await vi.waitFor(() => expect(intl.nextPageLabel).toBe('Next page'));
    transloco.setActiveLang('de');
    await vi.waitFor(() =>
      expect(intl.nextPageLabel).toBe(transloco.translate('kb.paginator.next')),
    );
    expect(intl.nextPageLabel).not.toBe('Next page');
  });

  it('PaginatorIntl_HostDestroyed_Unsubscribes', async () => {
    const f = TestBed.createComponent(PaginatorHost);
    const intl = f.componentInstance.intl;
    await vi.waitFor(() => expect(intl.nextPageLabel).toBe('Next page'));
    const changes = vi.fn();
    intl.changes.subscribe(changes);

    f.destroy();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await new Promise((r) => setTimeout(r));

    // A destroyed page's intl no longer listens to the root TranslocoService (no leak, no stale updates).
    expect(changes).not.toHaveBeenCalled();
    expect(intl.nextPageLabel).toBe('Next page');
  });
});
