import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { AuthStore } from '../../../core/auth/auth.store';
import { currentUser, problem, tokenResponse } from '../../../core/auth/auth.testing';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { ChangePassword } from './change-password';

describe('ChangePasswordComponent', () => {
  let ctrl: HttpTestingController;
  let store: AuthStore;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function setup(
    mustChange: boolean,
    returnUrl?: string,
  ): Promise<ComponentFixture<ChangePassword>> {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}) },
          },
        },
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    store.setSession(tokenResponse('tok', mustChange));
    store.setUser(currentUser({ mustChangePassword: mustChange }));
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const f = TestBed.createComponent(ChangePassword);
    await f.whenStable();
    return f;
  }

  const el = (f: ComponentFixture<ChangePassword>) => f.nativeElement as HTMLElement;
  async function fill(
    f: ComponentFixture<ChangePassword>,
    cur: string,
    next: string,
    confirm: string,
  ) {
    const values: [string, string][] = [
      ['currentPassword', cur],
      ['newPassword', next],
      ['confirmPassword', confirm],
    ];
    for (const [n, v] of values) {
      const i = el(f).querySelector<HTMLInputElement>(`input[formControlName="${n}"]`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
      i.dispatchEvent(new Event('blur'));
    }
    await f.whenStable();
  }
  async function submit(f: ComponentFixture<ChangePassword>) {
    el(f).querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await f.whenStable();
  }
  const noContent = { status: 204, statusText: 'No Content' };

  it('ChangePasswordComponent_MismatchedConfirm_ShowsError', async () => {
    const f = await setup(false);
    await fill(f, 'Old-Password-1', 'New-Password-123', 'New-Password-124');
    await submit(f);
    ctrl.expectNone('/api/auth/password');
    expect(el(f).textContent).toContain('Passwords do not match');
  });

  it.each([
    ['short', 'Ab1', 'must have at least 12'],
    ['no upper', 'lowercase-only-123', 'at least one upper-case'],
    ['no lower', 'UPPERCASE-ONLY-123', 'at least one lower-case'],
    ['no digit', 'No-Digits-Here-Abc', 'at least one digit'],
    ['non-ASCII upper only', 'äpfel-kuchen-12xÄ', 'at least one upper-case'],
    ['non-ASCII lower only', 'ABCDEFGHIJKL-12ß', 'at least one lower-case'],
    ['too long', `Aa1${'x'.repeat(130)}`, 'at most 128'],
  ])('ChangePasswordComponent_PolicyViolation_%s', async (_n, pw, msg) => {
    const f = await setup(false);
    await fill(f, 'Old-Password-1', pw, pw);
    await submit(f);
    ctrl.expectNone('/api/auth/password');
    expect(el(f).textContent).toContain(msg);
  });

  it('ChangePasswordComponent_SameAsCurrent_ShowsError', async () => {
    const f = await setup(false);
    await fill(f, 'Same-Password-1', 'Same-Password-1', 'Same-Password-1');
    await submit(f);
    ctrl.expectNone('/api/auth/password');
    expect(el(f).textContent).toContain('must be different');
  });

  it('ChangePasswordComponent_Success_ClearsFlag_AndContinues', async () => {
    const f = await setup(true, '/knowledge-bases');
    await fill(f, 'Old-Password-1', 'New-Password-123', 'New-Password-123');
    await submit(f);
    const req = ctrl.expectOne('/api/auth/password');
    expect(req.request.body).toEqual({
      currentPassword: 'Old-Password-1',
      newPassword: 'New-Password-123',
    });
    req.flush(null, noContent);
    await f.whenStable();
    expect(store.mustChangePassword()).toBe(false);
    expect(store.isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/knowledge-bases');
  });

  it('ChangePasswordComponent_UnsafeReturnUrl_GoesHome', async () => {
    const f = await setup(false, '//evil.com');
    await fill(f, 'Old-Password-1', 'New-Password-123', 'New-Password-123');
    await submit(f);
    ctrl.expectOne('/api/auth/password').flush(null, noContent);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('ChangePasswordComponent_Server400_ShowsGenericMessage_NoEcho', async () => {
    const f = await setup(false);
    await fill(f, 'Old-Password-1', 'New-Password-123', 'New-Password-123');
    await submit(f);
    ctrl.expectOne('/api/auth/password').flush(
      {
        ...problem(400, 'https://enterprise-rag.local/problems/validation'),
        errors: { currentPassword: ['bad Old-Password-1'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await f.whenStable();
    const alert = el(f).querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('could not be changed');
    expect(alert.textContent).not.toContain('Old-Password-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ChangePasswordComponent_ShowsBanner_WhenRequired', async () => {
    const f = await setup(true);
    expect(el(f).querySelector('[data-testid=must-change-banner]')).not.toBeNull();
  });

  it('ChangePasswordComponent_NoBanner_WhenNotRequired', async () => {
    const f = await setup(false);
    expect(el(f).querySelector('[data-testid=must-change-banner]')).toBeNull();
  });
});
