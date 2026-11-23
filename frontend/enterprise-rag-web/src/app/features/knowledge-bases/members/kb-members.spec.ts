import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { UserPicker } from '../../../shared/user-picker/user-picker';
import { KB_ID, makeMember, problemBody } from '../kb.testing';
import { KbMembers } from './kb-members';

const OWNER = makeMember({
  userId: 'u-owner',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'Owner',
});
const EDITOR = makeMember();
const MEMBERS_URL = `/api/knowledge-bases/${KB_ID}/members`;

describe('KbMembers', () => {
  let ctrl: HttpTestingController;

  async function setup(canManage: boolean): Promise<ComponentFixture<KbMembers>> {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [KbMembers],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(KbMembers);
    f.componentRef.setInput('kbId', KB_ID);
    f.componentRef.setInput('canManage', canManage);
    await f.whenStable();
    ctrl.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    await f.whenStable();
    return f;
  }
  const el = (f: ComponentFixture<KbMembers>) => f.nativeElement as HTMLElement;
  const confirmWith = (answer: boolean) =>
    vi
      .spyOn(TestBed.inject(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(answer) } as never);
  const picker = (f: ComponentFixture<KbMembers>) => f.debugElement.query(By.directive(UserPicker));

  it('Members_ListShowsNameEmailRole', async () => {
    const f = await setup(false);
    const rows = el(f).querySelectorAll('[data-testid="member-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Ada Lovelace');
    expect(rows[0].textContent).toContain('ada@example.com');
    expect(rows[0].textContent).toContain('Owner');
    expect(rows[1].textContent).toContain('Grace Hopper');
    expect(rows[1].textContent).toContain('Editor');
    expect(el(f).querySelector('table')).not.toBeNull();
  });

  it('Members_NonOwner_ReadOnly_NoControls', async () => {
    const f = await setup(false);
    expect(el(f).querySelector('[data-testid="add-member"]')).toBeNull();
    expect(el(f).querySelector('[data-testid="role-select"]')).toBeNull();
    expect(el(f).querySelector('[data-testid="remove-member"]')).toBeNull();
    expect(picker(f)).toBeNull();
    expect(el(f).textContent).toContain('Only owners can change members.');
  });

  it('Members_Add_UsesDebouncedDirectorySearch_MinTwoChars', async () => {
    const f = await setup(true);
    vi.useFakeTimers();
    try {
      const input = el(f).querySelector<HTMLInputElement>('[data-testid="user-picker-input"]')!;
      const typeText = async (v: string) => {
        input.value = v;
        input.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(0);
      };

      await typeText('a');
      await vi.advanceTimersByTimeAsync(1000);
      ctrl.expectNone((r) => r.url === '/api/users/directory');

      await typeText('ad');
      await vi.advanceTimersByTimeAsync(299);
      ctrl.expectNone((r) => r.url === '/api/users/directory');
      await typeText('ada'); // restarts the debounce window
      await vi.advanceTimersByTimeAsync(299);
      ctrl.expectNone((r) => r.url === '/api/users/directory');
      await vi.advanceTimersByTimeAsync(1);
      const req = ctrl.expectOne((r) => r.url === '/api/users/directory');
      expect(req.request.params.get('query')).toBe('ada');
      req.flush([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Members_Add_PostsSelectedUser_AndNotifiesChange', async () => {
    const f = await setup(true);
    const changed = vi.fn();
    f.componentInstance.membershipChanged.subscribe(changed);
    picker(f).componentInstance.selected.emit({
      id: 'u-new',
      displayName: 'Linus',
      email: 'l@example.com',
    });
    await f.whenStable();
    el(f).querySelector<HTMLButtonElement>('[data-testid="add-member"]')!.click();
    await f.whenStable();
    const req = ctrl.expectOne(MEMBERS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'u-new', role: 'Viewer' });
    req.flush(makeMember({ userId: 'u-new', role: 'Viewer' }), {
      status: 201,
      statusText: 'Created',
    });
    await f.whenStable();
    ctrl.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]); // list reload
    await f.whenStable();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('Members_Add_409And404_ShowTranslatedMessages', async () => {
    const f = await setup(true);
    const addUser = async () => {
      picker(f).componentInstance.selected.emit({ id: 'u-new', displayName: 'L', email: 'l@x.io' });
      await f.whenStable();
      el(f).querySelector<HTMLButtonElement>('[data-testid="add-member"]')!.click();
      await f.whenStable();
    };
    await addUser();
    ctrl
      .expectOne(MEMBERS_URL)
      .flush(problemBody(409, PROBLEM_TYPES.conflict), { status: 409, statusText: 'x' });
    await f.whenStable();
    expect(el(f).querySelector('[data-testid="members-error"]')?.textContent).toContain(
      'already a member',
    );

    await addUser();
    ctrl
      .expectOne(MEMBERS_URL)
      .flush(problemBody(404, PROBLEM_TYPES.notFound), { status: 404, statusText: 'x' });
    await f.whenStable();
    const text = el(f).querySelector('[data-testid="members-error"]')?.textContent;
    expect(text).toContain('could not be found');
    expect(text).not.toContain('SERVER DETAIL');
  });

  async function pickRole(f: ComponentFixture<KbMembers>, rowIndex: number, label: string) {
    const selects = el(f).querySelectorAll<HTMLElement>(
      '[data-testid="role-select"] .mat-mdc-select-trigger',
    );
    selects[rowIndex].click();
    await f.whenStable();
    const opt = Array.from(document.querySelectorAll<HTMLElement>('mat-option')).find((o) =>
      o.textContent?.includes(label),
    )!;
    opt.click();
    await f.whenStable();
  }

  it('Members_ChangeRole_PutsRole_ThenReloads_AndNotifies', async () => {
    const f = await setup(true);
    const changed = vi.fn();
    f.componentInstance.membershipChanged.subscribe(changed);
    await pickRole(f, 1, 'Viewer');
    const req = ctrl.expectOne(`${MEMBERS_URL}/${EDITOR.userId}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ role: 'Viewer' });
    req.flush({ ...EDITOR, role: 'Viewer' });
    await f.whenStable();
    ctrl.expectOne(MEMBERS_URL).flush([OWNER, { ...EDITOR, role: 'Viewer' }]);
    await f.whenStable();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('Members_LastOwner409_ShowsTranslatedMessage', async () => {
    const f = await setup(true);
    await pickRole(f, 0, 'Editor');
    ctrl
      .expectOne(`${MEMBERS_URL}/${OWNER.userId}`)
      .flush(problemBody(409, PROBLEM_TYPES.conflict), { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    expect(el(f).querySelector('[data-testid="members-error"]')?.textContent).toContain(
      'must keep at least one owner',
    );
  });

  it('Members_Remove_Confirms_ThenDeletes_AndNotifies', async () => {
    const f = await setup(true);
    const open = confirmWith(true);
    const changed = vi.fn();
    f.componentInstance.membershipChanged.subscribe(changed);
    el(f).querySelectorAll<HTMLButtonElement>('[data-testid="remove-member"]')[1].click();
    await f.whenStable();
    expect(open).toHaveBeenCalledTimes(1);
    ctrl
      .expectOne(`${MEMBERS_URL}/${EDITOR.userId}`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await f.whenStable();
    ctrl.expectOne(MEMBERS_URL).flush([OWNER]);
    await f.whenStable();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(MatSnackBar)).toBeTruthy();
    expect(el(f).querySelectorAll('[data-testid="member-row"]').length).toBe(1);
  });

  it('Members_Remove_Declined_DoesNothing', async () => {
    const f = await setup(true);
    confirmWith(false);
    el(f).querySelectorAll<HTMLButtonElement>('[data-testid="remove-member"]')[1].click();
    await f.whenStable();
    ctrl.expectNone(`${MEMBERS_URL}/${EDITOR.userId}`);
  });

  it('Members_Remove_LastOwner409_ShowsTranslatedMessage', async () => {
    const f = await setup(true);
    confirmWith(true);
    el(f).querySelectorAll<HTMLButtonElement>('[data-testid="remove-member"]')[0].click();
    await f.whenStable();
    ctrl
      .expectOne(`${MEMBERS_URL}/${OWNER.userId}`)
      .flush(problemBody(409, PROBLEM_TYPES.conflict), { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    expect(el(f).querySelector('[data-testid="members-error"]')?.textContent).toContain(
      'must keep at least one owner',
    );
  });
});
