import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { KB_ID, makeKb, problemBody } from '../kb.testing';
import { KbList } from './kb-list';

describe('KbList', () => {
  let ctrl: HttpTestingController;

  async function setup(): Promise<ComponentFixture<KbList>> {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [KbList],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(KbList);
    await fixture.whenStable();
    return fixture;
  }
  const page = () => ctrl.expectOne((r) => r.url === '/api/knowledge-bases');
  const el = (f: ComponentFixture<KbList>) => f.nativeElement as HTMLElement;

  it('KbList_ShowsEmptyState_WhenNoKnowledgeBases', async () => {
    const f = await setup();
    const req = page();
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush({ items: [], page: 1, pageSize: 10, totalCount: 0 });
    await f.whenStable();
    expect(el(f).querySelector('[data-testid="empty-state"]')?.textContent).toContain(
      'not a member of any knowledge base',
    );
    expect(el(f).querySelector('[data-testid="new-kb"]')).not.toBeNull();
  });

  it('KbList_ShowsRows_WithTranslatedRole', async () => {
    const f = await setup();
    page().flush({
      items: [makeKb(), makeKb({ id: 'b', name: 'Other', myRole: 'Viewer' })],
      page: 1,
      pageSize: 10,
      totalCount: 2,
    });
    await f.whenStable();
    const rows = el(f).querySelectorAll('[data-testid="kb-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('HR handbook');
    expect(rows[0].textContent).toContain('Owner');
    expect(rows[1].textContent).toContain('Viewer');
  });

  it('KbList_Pages', async () => {
    const f = await setup();
    page().flush({ items: [makeKb()], page: 1, pageSize: 10, totalCount: 25 });
    await f.whenStable();
    el(f).querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')!.click();
    await f.whenStable();
    const req = page();
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush({ items: [makeKb({ name: 'Page two' })], page: 2, pageSize: 10, totalCount: 25 });
    await f.whenStable();
    expect(el(f).textContent).toContain('Page two');
  });

  it('KbList_Error_ShowsRetryAndCorrelationId', async () => {
    const f = await setup();
    page().flush(problemBody(500, PROBLEM_TYPES.internalError, 'cid-500'), {
      status: 500,
      statusText: 'Server Error',
    });
    await f.whenStable();
    const err = el(f).querySelector('[data-testid="list-error"]')!;
    expect(err.textContent).toContain('Something went wrong');
    expect(err.textContent).toContain('cid-500');
    expect(err.textContent).not.toContain('SERVER DETAIL');
    el(f).querySelector<HTMLButtonElement>('[data-testid="retry"]')!.click();
    await f.whenStable();
    page().flush({ items: [], page: 1, pageSize: 10, totalCount: 0 });
  });

  it('KbList_RowClick_NavigatesToDetail', async () => {
    const f = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    page().flush({ items: [makeKb()], page: 1, pageSize: 10, totalCount: 1 });
    await f.whenStable();
    el(f).querySelector<HTMLElement>('[data-testid="kb-row"]')!.click();
    expect(nav).toHaveBeenCalledWith(['/knowledge-bases', KB_ID]);
  });

  it('KbName_WithScriptTag_RendersAsText', async () => {
    const f = await setup();
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    page().flush({
      items: [makeKb({ name: evil, description: evil })],
      page: 1,
      pageSize: 10,
      totalCount: 1,
    });
    await f.whenStable();
    expect(el(f).textContent).toContain(evil);
    expect(el(f).querySelector('script')).toBeNull();
    expect(el(f).querySelector('img')).toBeNull();
  });
});
