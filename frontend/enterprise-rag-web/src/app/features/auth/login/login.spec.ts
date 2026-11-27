import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { currentUser, problem, tokenResponse } from '../../../core/auth/auth.testing';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { Login } from './login';

describe('LoginComponent', () => {
  let ctrl: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function setup(returnUrl?: string): Promise<ComponentFixture<Login>> {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Login],
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
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    return fixture;
  }

  const el = (f: ComponentFixture<Login>) => f.nativeElement as HTMLElement;
  const input = (f: ComponentFixture<Login>, name: string) =>
    el(f).querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
  async function fill(f: ComponentFixture<Login>, email: string, password: string) {
    for (const [n, v] of [
      ['email', email],
      ['password', password],
    ]) {
      const i = input(f, n);
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await f.whenStable();
  }
  async function submit(f: ComponentFixture<Login>) {
    el(f).querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await f.whenStable();
  }
  const answerLogin = (mustChange: boolean) => {
    ctrl.expectOne('/api/auth/login').flush(tokenResponse('tok', mustChange));
    ctrl.expectOne('/api/me').flush(currentUser({ mustChangePassword: mustChange }));
  };
  const fail = (status: number, type: string) =>
    ctrl.expectOne('/api/auth/login').flush(problem(status, type), { status, statusText: 'x' });

  async function login(f: ComponentFixture<Login>) {
    await fill(f, 'ada@example.com', 'Secret-Password1');
    await submit(f);
  }
  const target = () => {
    const arg = navigate.mock.calls[0][0] as string | UrlTree;
    return typeof arg === 'string' ? arg : TestBed.inject(Router).serializeUrl(arg);
  };

  it('LoginComponent_ValidCredentials_NavigatesToReturnUrl', async () => {
    const f = await setup('/knowledge-bases/5');
    await login(f);
    const req = ctrl.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'ada@example.com',
      password: 'Secret-Password1',
    });
    req.flush(tokenResponse('tok'));
    ctrl.expectOne('/api/me').flush(currentUser());
    await f.whenStable();
    expect(target()).toBe('/knowledge-bases/5');
  });

  it('LoginComponent_NoReturnUrl_GoesHome', async () => {
    const f = await setup();
    await login(f);
    answerLogin(false);
    expect(target()).toBe('/');
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])(
    'LoginComponent_Rejects_UnsafeReturnUrls %s',
    async (bad) => {
      const f = await setup(bad);
      await login(f);
      answerLogin(false);
      expect(target()).toBe('/');
    },
  );

  it('LoginComponent_MustChangeResponse_GoesToChangePassword', async () => {
    const f = await setup('/admin');
    await login(f);
    answerLogin(true);
    expect(target()).toBe('/change-password?returnUrl=%2Fadmin');
  });

  it('LoginComponent_401_ShowsGenericMessage_NoFieldHint', async () => {
    const f = await setup();
    await login(f);
    fail(401, 'https://enterprise-rag.local/problems/unauthorized');
    await f.whenStable();
    const alert = el(f).querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('Invalid email or password');
    expect(el(f).querySelector('mat-error')).toBeNull();
    expect(input(f, 'email').value).toBe('ada@example.com');
    expect(input(f, 'password').value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
    expect(el(f).querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });

  it('LoginComponent_429_ShowsRateLimitMessage', async () => {
    const f = await setup();
    await login(f);
    fail(429, 'https://enterprise-rag.local/problems/too-many-requests');
    await f.whenStable();
    expect(el(f).querySelector('[role=alert]')!.textContent).toContain('Too many attempts');
  });

  it('LoginComponent_OtherError_ShowsGenericWithCorrelationId', async () => {
    const f = await setup();
    await login(f);
    fail(500, 'https://enterprise-rag.local/problems/internal');
    await f.whenStable();
    const text = el(f).querySelector('[role=alert]')!.textContent!;
    expect(text).toContain('Something went wrong');
    expect(text).toContain('Reference: cid-1');
  });

  it('LoginComponent_Pending_DisablesSubmit', async () => {
    const f = await setup();
    await login(f);
    expect(el(f).querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    ctrl.expectOne('/api/auth/login');
  });

  it('LoginComponent_InvalidForm_DoesNotCallApi', async () => {
    const f = await setup();
    await fill(f, 'not-an-email', '');
    await submit(f);
    ctrl.expectNone('/api/auth/login');
    expect(el(f).querySelectorAll('mat-error').length).toBeGreaterThan(0);
  });

  it('Login_HasAccessibleLabels', async () => {
    const f = await setup();
    await login(f);
    fail(401, 'https://enterprise-rag.local/problems/unauthorized');
    await f.whenStable();
    const inputs = Array.from(el(f).querySelectorAll('input'));
    expect(inputs.length).toBe(2);
    for (const i of inputs) {
      expect(i.labels?.length ?? 0).toBeGreaterThan(0);
      expect(i.labels![0].textContent!.trim().length).toBeGreaterThan(0);
    }
    const alert = el(f).querySelector('[role=alert], [aria-live]');
    expect(alert).not.toBeNull();
  });

  it('LoginComponent_ProxyBadGateway_ShowsNetworkMessage', async () => {
    const f = await setup();
    await login(f);
    ctrl
      .expectOne('/api/auth/login')
      .flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    await f.whenStable();
    const text = el(f).querySelector('[role=alert]')!.textContent!;
    expect(text).toContain('Cannot reach the server');
    expect(text).not.toContain('Something went wrong');
  });

  it('EmailInputs_AreLtr (login)', async () => {
    const f = await setup();
    expect(input(f, 'email').getAttribute('dir')).toBe('ltr');
  });
});
