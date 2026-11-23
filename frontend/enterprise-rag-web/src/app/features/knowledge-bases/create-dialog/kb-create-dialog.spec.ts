import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ANIMATION_MODULE_TYPE, ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { makeKb, problemBody } from '../kb.testing';
import { KbCreateDialog } from './kb-create-dialog';

describe('KbCreateDialog', () => {
  let ctrl: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;

  async function setup(): Promise<ComponentFixture<KbCreateDialog>> {
    localStorage.clear();
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [KbCreateDialog],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(KbCreateDialog);
    await f.whenStable();
    return f;
  }
  const el = (f: ComponentFixture<KbCreateDialog>) => f.nativeElement as HTMLElement;
  async function type(f: ComponentFixture<KbCreateDialog>, name: string, value: string) {
    const i = el(f).querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
    i.value = value;
    i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new Event('blur'));
    await f.whenStable();
  }
  const submit = async (f: ComponentFixture<KbCreateDialog>) => {
    el(f).querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await f.whenStable();
  };

  it('KbCreate_ValidatesNameLength', async () => {
    const f = await setup();
    await type(f, 'name', '');
    expect(el(f).textContent).toContain('Enter a name.');
    await type(f, 'name', 'x'.repeat(201));
    expect(el(f).textContent).toContain('at most 200 characters');
    await submit(f);
    ctrl.expectNone('/api/knowledge-bases');
    await type(f, 'name', 'x'.repeat(200));
    expect(el(f).textContent).not.toContain('at most 200 characters');
    await type(f, 'description', 'd'.repeat(2001));
    expect(el(f).textContent).toContain('at most 2000 characters');
  });

  it('KbCreate_Success_ClosesWithCreatedKb', async () => {
    const f = await setup();
    await type(f, 'name', 'Legal');
    await type(f, 'description', 'Contracts');
    await submit(f);
    const req = ctrl.expectOne('/api/knowledge-bases');
    expect(req.request.body).toEqual({ name: 'Legal', description: 'Contracts' });
    req.flush(makeKb({ name: 'Legal' }), {
      status: 201,
      statusText: 'Created',
      headers: { ETag: '"e"' },
    });
    await f.whenStable();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ name: 'Legal' }));
  });

  it('KbCreate_DisablesSubmit_WhilePending', async () => {
    const f = await setup();
    await type(f, 'name', 'Legal');
    await submit(f);
    expect(el(f).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    ctrl.expectOne('/api/knowledge-bases').flush(makeKb(), { status: 201, statusText: 'Created' });
  });

  it('KbCreate_400_ShowsGenericFieldError_NeverServerText', async () => {
    const f = await setup();
    await type(f, 'name', 'Legal');
    await submit(f);
    ctrl.expectOne('/api/knowledge-bases').flush(
      {
        type: PROBLEM_TYPES.validation,
        title: 'v',
        status: 400,
        errors: { Name: ['SERVER FIELD TEXT'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await f.whenStable();
    expect(el(f).textContent).toContain('The server rejected this value.');
    expect(el(f).textContent).not.toContain('SERVER FIELD TEXT');
    expect(close).not.toHaveBeenCalled();
  });

  it('KbCreate_WhitespaceName_Invalid', async () => {
    const f = await setup();
    await type(f, 'name', '    ');
    await submit(f);
    ctrl.expectNone('/api/knowledge-bases');
    expect(el(f).textContent).toContain('Enter a name.');
    expect(close).not.toHaveBeenCalled();
  });

  it('KbCreate_500_ShowsBannerWithCorrelationId', async () => {
    const f = await setup();
    await type(f, 'name', 'Legal');
    await submit(f);
    ctrl
      .expectOne('/api/knowledge-bases')
      .flush(
        { type: PROBLEM_TYPES.internalError, title: 't', status: 500, correlationId: 'cid-77' },
        { status: 500, statusText: 'x' },
      );
    await f.whenStable();
    expect(el(f).querySelector('[role="alert"]')?.textContent).toContain('cid-77');
  });
});

/** Opened through the real MatDialog, so Escape, backdrop and disableClose behave as in the app. */
describe('KbCreateDialog (real dialog)', () => {
  let ctrl: HttpTestingController;

  afterEach(() => {
    ctrl.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove());
  });

  it('KbCreate_CannotBeDismissedWhilePending', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
        { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const ref = TestBed.inject(MatDialog).open(KbCreateDialog);
    let closed = false;
    ref.afterClosed().subscribe(() => (closed = true));
    const name = await vi.waitFor(() => {
      const i = document.querySelector<HTMLInputElement>('input[formcontrolname="name"]');
      if (!i) throw new Error('not rendered yet');
      return i;
    });
    await TestBed.inject(ApplicationRef).whenStable();
    name.value = 'Legal';
    name.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const req = ctrl.expectOne('/api/knowledge-bases');

    expect(ref.disableClose).toBe(true);
    const cancel = document.querySelector<HTMLButtonElement>('[data-testid="cancel"]')!;
    await vi.waitFor(() => expect(cancel.disabled).toBe(true));
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }),
    );
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    cancel.click();
    await Promise.resolve();
    expect(closed).toBe(false);

    req.flush(problemBody(500, PROBLEM_TYPES.internalError), { status: 500, statusText: 'x' });
    await vi.waitFor(() => expect(ref.disableClose).toBe(false));
    expect(closed).toBe(false);
    await vi.waitFor(() => expect(cancel.disabled).toBe(false));
    cancel.click();
    await vi.waitFor(() => expect(closed).toBe(true));
  });
});
