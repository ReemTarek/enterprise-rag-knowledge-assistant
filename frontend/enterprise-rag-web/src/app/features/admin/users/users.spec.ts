import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ANIMATION_MODULE_TYPE, ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { AuthStore } from '../../../core/auth/auth.store';
import { currentUser, tokenResponse } from '../../../core/auth/auth.testing';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { problemBody } from '../../knowledge-bases/kb.testing';
import { AdminUser } from '../users.models';
import { TEMP_PASSWORD, USER_ID, makeAdminUser } from '../users.testing';
import { TempPasswordDialog } from '../temp-password-dialog/temp-password-dialog';
import { Users } from './users';
import { isolatedTexts } from '../../../shared/bidi/bidi.testing';

const SELF_ID = '7d1f6c1e-0000-4000-8000-000000000001';

describe('Users page', () => {
  let ctrl: HttpTestingController;

  async function setup(): Promise<ComponentFixture<Users>> {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Users],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
        { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' },
      ],
    });
    const store = TestBed.inject(AuthStore);
    store.setSession(tokenResponse('tok'));
    store.setUser(currentUser({ id: SELF_ID, globalRole: 'Admin' }));
    ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Users);
    await fixture.whenStable();
    return fixture;
  }
  const list = () => ctrl.expectOne((r) => r.url === '/api/admin/users' && r.method === 'GET');
  const paged = (items: AdminUser[], totalCount = items.length) => ({
    items,
    page: 1,
    pageSize: 10,
    totalCount,
  });
  const el = (f: ComponentFixture<Users>) => f.nativeElement as HTMLElement;
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;
  const tid = (id: string) => `[data-testid="${id}"]`;
  const confirmYes = async () => {
    await vi.waitFor(() => expect(q(tid('confirm-yes'))).not.toBeNull());
    q(tid('confirm-yes')).click();
  };
  async function loaded(items: AdminUser[], total?: number) {
    const f = await setup();
    list().flush(paged(items, total));
    await f.whenStable();
    return f;
  }
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  /** The production opener must pin the one-time-secret dialog: not dismissable, survives navigation. */
  function expectTempDialogPinned() {
    const ref = TestBed.inject(MatDialog).openDialogs.at(-1)!;
    expect(ref.componentInstance).toBeInstanceOf(TempPasswordDialog);
    expect(ref.disableClose).toBe(true);
    const cfg = (ref as unknown as { _containerInstance: { _config: MatDialogConfig } })._containerInstance._config;
    expect(cfg.closeOnNavigation).toBe(false);
    expect(cfg.disableClose).toBe(true);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }),
    );
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    expect(TestBed.inject(MatDialog).openDialogs.at(-1)).toBe(ref);
  }
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    vi.restoreAllMocks();
    ctrl.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove());
  });

  it('AdminUsers_List_Pages', async () => {
    const f = await setup();
    const first = list();
    expect(first.request.params.get('page')).toBe('1');
    expect(first.request.params.get('pageSize')).toBe('10');
    first.flush(
      paged(
        [
          makeAdminUser({ globalRole: 'Admin', mustChangePassword: true }),
          makeAdminUser({
            id: 'u2',
            displayName: 'Locked One',
            isActive: false,
            lockoutEndUtc: '2026-11-30T10:00:00Z',
          }),
        ],
        25,
      ),
    );
    await f.whenStable();
    const rows = el(f).querySelectorAll(tid('user-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Grace Hopper');
    expect(rows[0].textContent).toContain('grace@example.com');
    expect(rows[0].textContent).toContain('Administrator');
    expect(rows[0].textContent).toContain('Active');
    expect(rows[0].querySelector(tid('must-change'))).not.toBeNull();
    expect(rows[1].textContent).toContain('Inactive');
    expect(rows[1].textContent).toContain('Nov 30, 2026');
    // Inactive users cannot be deactivated again.
    expect(rows[1].querySelector(tid('deactivate'))).toBeNull();

    el(f).querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')!.click();
    await f.whenStable();
    const second = list();
    expect(second.request.params.get('page')).toBe('2');
    second.flush({ items: [makeAdminUser({ displayName: 'Page two' })], page: 2, pageSize: 10, totalCount: 25 });
    await f.whenStable();
    expect(el(f).textContent).toContain('Page two');
  });

  it('AdminUsers_ShowsEmptyAndErrorStates', async () => {
    const f = await setup();
    list().flush(problemBody(500, PROBLEM_TYPES.internalError, 'cid-500'), {
      status: 500,
      statusText: 'Server Error',
    });
    await f.whenStable();
    const err = el(f).querySelector(tid('list-error'))!;
    expect(err.textContent).toContain('Something went wrong');
    expect(err.textContent).toContain('cid-500');
    expect(err.textContent).not.toContain('SERVER DETAIL');
    el(f).querySelector<HTMLButtonElement>(tid('retry'))!.click();
    await f.whenStable();
    list().flush(paged([]));
    await f.whenStable();
    expect(el(f).querySelector(tid('empty-state'))?.textContent).toContain('no users');
  });

  it('UserDisplayName_WithHtml_RendersAsText', async () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const f = await loaded([makeAdminUser({ displayName: evil, email: 'x@y.co' })]);
    expect(el(f).textContent).toContain(evil);
    expect(el(f).querySelector('script')).toBeNull();
    expect(el(f).querySelector('img')).toBeNull();
  });

  it('Users_HidesDeactivate_ForOwnRow', async () => {
    const f = await loaded([makeAdminUser({ id: SELF_ID }), makeAdminUser()]);
    const rows = el(f).querySelectorAll(tid('user-row'));
    expect(rows[0].querySelector(tid('deactivate'))).toBeNull();
    expect(rows[1].querySelector(tid('deactivate'))).not.toBeNull();
  });

  it('Deactivate_Confirms_ThenRefreshes', async () => {
    const f = await loaded([makeAdminUser()]);
    el(f).querySelector<HTMLButtonElement>(tid('deactivate'))!.click();
    await confirmYes();
    const req = ctrl.expectOne(`/api/admin/users/${USER_ID}/deactivate`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await f.whenStable();
    list().flush(paged([makeAdminUser({ isActive: false })]));
    await f.whenStable();
    expect(el(f).textContent).toContain('Inactive');
  });

  it('Deactivate_Cancelled_SendsNothing', async () => {
    const f = await loaded([makeAdminUser()]);
    el(f).querySelector<HTMLButtonElement>(tid('deactivate'))!.click();
    await vi.waitFor(() => expect(q(tid('confirm-no'))).not.toBeNull());
    q(tid('confirm-no')).click();
    await f.whenStable();
  });

  it('Deactivate_Self409_ShowsMessage', async () => {
    const f = await loaded([makeAdminUser()]);
    el(f).querySelector<HTMLButtonElement>(tid('deactivate'))!.click();
    await confirmYes();
    ctrl
      .expectOne(`/api/admin/users/${USER_ID}/deactivate`)
      .flush(problemBody(409, PROBLEM_TYPES.conflict), { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    expect(el(f).querySelector(tid('action-error'))?.textContent).toContain(
      'cannot deactivate your own account',
    );
  });

  it('ResetPassword_Confirms_ThenShowsTempDialog', async () => {
    const f = await loaded([makeAdminUser()]);
    el(f).querySelector<HTMLButtonElement>(tid('reset'))!.click();
    await confirmYes();
    const req = ctrl.expectOne(`/api/admin/users/${USER_ID}/reset-password`);
    req.flush({ temporaryPassword: TEMP_PASSWORD });
    await vi.waitFor(() =>
      expect((q(tid('password-field')) as HTMLInputElement).value).toBe(TEMP_PASSWORD),
    );
    expect(document.body.textContent).toContain('Grace Hopper');
    expectTempDialogPinned();
    list().flush(paged([makeAdminUser({ mustChangePassword: true })]));
  });

  async function createUser(f: ComponentFixture<Users>): Promise<TestRequest> {
    el(f).querySelector<HTMLButtonElement>(tid('new-user'))!.click();
    await vi.waitFor(() => expect(q('input[formcontrolname="email"]')).not.toBeNull());
    await TestBed.inject(ApplicationRef).whenStable();
    const set = (n: string, v: string) => {
      const i = q(`input[formcontrolname="${n}"]`) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    set('email', 'new@example.com');
    set('displayName', 'New Person');
    q(tid('submit')).click();
    return ctrl.expectOne((r) => r.url === '/api/admin/users' && r.method === 'POST');
  }

  it('CreateUser_DialogSurvivesNavigation', async () => {
    const f = await loaded([]);
    el(f).querySelector<HTMLButtonElement>(tid('new-user'))!.click();
    const ref = TestBed.inject(MatDialog).openDialogs.at(-1)!;
    const cfg = (ref as unknown as { _containerInstance: { _config: MatDialogConfig } })
      ._containerInstance._config;
    expect(cfg.closeOnNavigation).toBe(false);
    ref.close();
  });

  it('CreateUser_ShowsTemporaryPasswordOnce_AndClearsItOnClose', async () => {
    const f = await loaded([]);
    const post = await createUser(f);
    post.flush(
      { id: USER_ID, email: 'new@example.com', temporaryPassword: TEMP_PASSWORD },
      { status: 201, statusText: 'Created' },
    );
    await vi.waitFor(() =>
      expect((q(tid('password-field')) as HTMLInputElement).value).toBe(TEMP_PASSWORD),
    );
    expect(document.body.textContent).toContain('New Person');
    expectTempDialogPinned();
    list().flush(paged([makeAdminUser({ displayName: 'New Person' })]));
    // Acknowledge and close: the password is gone from the DOM.
    q(tid('ack')).querySelector<HTMLInputElement>('input')!.click();
    await vi.waitFor(() => expect((q(tid('close')) as HTMLButtonElement).disabled).toBe(false));
    q(tid('close')).click();
    await vi.waitFor(() => expect(document.querySelector(tid('password-field'))).toBeNull());
    expect(document.body.textContent).not.toContain(TEMP_PASSWORD);
    expect(el(f).textContent).not.toContain(TEMP_PASSWORD);
  });

  it('TempPassword_NeverEnters_StorageOrRouterState_OrLogs', async () => {
    const seen: unknown[] = [];
    const record = (...args: unknown[]) => void seen.push(args);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(record);
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(record),
    );
    const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => cookieDesc.get!.call(document),
      set: (v: string) => record(v),
    });
    const f = await loaded([]);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const replaceState = vi.spyOn(history, 'replaceState');
    const pushState = vi.spyOn(history, 'pushState');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });

    const post = await createUser(f);
    post.flush(
      { id: USER_ID, email: 'new@example.com', temporaryPassword: TEMP_PASSWORD },
      { status: 201, statusText: 'Created' },
    );
    await vi.waitFor(() => expect(q(tid('password-field'))).not.toBeNull());
    list().flush(paged([]));
    q(tid('copy')).click();
    await vi.waitFor(() => expect(q(tid('copy-status')).textContent).toContain('Copied'));
    q(tid('ack')).querySelector<HTMLInputElement>('input')!.click();
    await vi.waitFor(() => expect((q(tid('close')) as HTMLButtonElement).disabled).toBe(false));
    q(tid('close')).click();
    await vi.waitFor(() => expect(document.querySelector(tid('password-field'))).toBeNull());
    delete (document as unknown as Record<string, unknown>)['cookie'];

    const everything = JSON.stringify([
      seen,
      nav.mock.calls,
      navUrl.mock.calls,
      replaceState.mock.calls,
      pushState.mock.calls,
      consoleSpies.map((s) => s.mock.calls),
      router.url,
      location.href,
      history.state,
      { ...localStorage },
      { ...sessionStorage },
    ]);
    expect(everything).not.toContain(TEMP_PASSWORD);
    expect(document.cookie).not.toContain(TEMP_PASSWORD);
  });

  it('UserNames_AreBidiIsolated (admin users)', async () => {
    const f = await loaded([makeAdminUser({ displayName: 'Bob <b>', email: 'bob@example.com' })]);
    const row = el(f).querySelector(tid('user-row'))!;
    expect(isolatedTexts(row)).toEqual(expect.arrayContaining(['Bob <b>', 'bob@example.com']));
  });
});
