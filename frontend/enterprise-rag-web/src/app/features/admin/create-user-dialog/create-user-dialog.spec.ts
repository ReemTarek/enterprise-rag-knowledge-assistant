import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ANIMATION_MODULE_TYPE, ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { problemBody } from '../../knowledge-bases/kb.testing';
import { CreatedUserResult } from '../users.models';
import { TEMP_PASSWORD, USER_ID } from '../users.testing';
import { CreateUserDialog } from './create-user-dialog';

describe('CreateUserDialog', () => {
  let ctrl: HttpTestingController;
  let ref: MatDialogRef<CreateUserDialog, CreatedUserResult>;
  let result: CreatedUserResult | undefined;
  let closed: boolean;

  async function open() {
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
    ref = TestBed.inject(MatDialog).open(CreateUserDialog);
    closed = false;
    result = undefined;
    ref.afterClosed().subscribe((r) => {
      closed = true;
      result = r;
    });
    await vi.waitFor(() => expect(input('email')).not.toBeNull());
    await TestBed.inject(ApplicationRef).whenStable();
  }
  const input = (name: string) =>
    document.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
  const type = (name: string, value: string) => {
    const el = input(name);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const submit = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="submit"]')!.click();
  const post = () => ctrl.expectOne('/api/admin/users');
  const fill = (email = 'new@example.com', name = 'New Person') => {
    type('email', email);
    type('displayName', name);
  };
  afterEach(() => {
    ctrl.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove());
  });

  it('CreateUser_Submit_SendsTrimmedValuesAndEnumNameRole_ThenClosesWithResult', async () => {
    await open();
    fill('  new@example.com ', '  New Person  ');
    submit();
    const req = post();
    expect(req.request.body).toEqual({
      email: 'new@example.com',
      displayName: 'New Person',
      globalRole: 'User',
    });
    req.flush(
      { id: USER_ID, email: 'new@example.com', temporaryPassword: TEMP_PASSWORD },
      { status: 201, statusText: 'Created' },
    );
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(result).toEqual({
      id: USER_ID,
      email: 'new@example.com',
      temporaryPassword: TEMP_PASSWORD,
      displayName: 'New Person',
    });
  });

  it('CreateUser_WhitespaceName_Invalid', async () => {
    await open();
    fill('new@example.com', '    ');
    submit();
    ctrl.expectNone('/api/admin/users');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Enter a display name'));
    expect(closed).toBe(false);
  });

  it('CreateUser_InvalidEmail_IsNotSubmitted', async () => {
    await open();
    fill('not-an-email', 'Name');
    submit();
    ctrl.expectNone('/api/admin/users');
    await vi.waitFor(() => expect(document.body.textContent).toContain('valid email'));
  });

  it('CreateUser_DuplicateEmail409_ShowsMessage', async () => {
    await open();
    fill();
    submit();
    post().flush(problemBody(409, PROBLEM_TYPES.conflict), { status: 409, statusText: 'Conflict' });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="duplicate-email"]')?.textContent,
      ).toContain('already exists'),
    );
    expect(document.body.textContent).not.toContain('SERVER DETAIL');
    expect(closed).toBe(false);
  });

  it('CreateUser_BadRequest400_ShowsGenericMessage_WithoutEcho', async () => {
    await open();
    fill();
    submit();
    post().flush(problemBody(400, PROBLEM_TYPES.validation), { status: 400, statusText: 'Bad' });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('not valid'),
    );
    expect(document.body.textContent).not.toContain('SERVER DETAIL');
  });

  it('CreateUser_CannotBeDismissedWhilePending', async () => {
    await open();
    fill();
    submit();
    const req = post();
    expect(ref.disableClose).toBe(true);
    const cancel = document.querySelector<HTMLButtonElement>('[data-testid="cancel"]')!;
    await vi.waitFor(() => expect(cancel.disabled).toBe(true));
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }),
    );
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    await Promise.resolve();
    expect(closed).toBe(false);
    // A second submit while pending sends nothing.
    submit();
    req.flush(problemBody(500, PROBLEM_TYPES.internalError), { status: 500, statusText: 'x' });
    await vi.waitFor(() => expect(ref.disableClose).toBe(false));
    expect(closed).toBe(false);
  });

  it('EmailInputs_AreLtr (create user)', async () => {
    await open();
    expect(input('email').getAttribute('dir')).toBe('ltr');
    // The display name may be Arabic or Latin: it follows its own first strong character.
    expect(input('displayName').getAttribute('dir')).toBe('auto');
  });
});
