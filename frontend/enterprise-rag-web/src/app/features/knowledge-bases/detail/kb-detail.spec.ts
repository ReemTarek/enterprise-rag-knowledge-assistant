import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { PROBLEM_TYPES } from '../../../core/api/problem-details';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { KB_ROUTES } from '../kb.routes';
import { KB_ID, makeKb, makeMember, problemBody } from '../kb.testing';
import { KbRole } from '../kb.models';
import { isolatedTexts } from '../../../shared/bidi/bidi.testing';

const URL_ = `/api/knowledge-bases/${KB_ID}`;

describe('KbDetail', () => {
  let ctrl: HttpTestingController;
  let h: RouterTestingHarness;

  function configure() {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'knowledge-bases', children: KB_ROUTES }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
  }
  const el = () => h.routeNativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el().querySelector<T>(`[data-testid="${id}"]`);
  const stable = () => h.fixture.whenStable();

  /** Navigates and answers the initial GET. */
  async function load(role: KbRole = 'Owner', over = {}, etag = '"v1"') {
    configure();
    h = await RouterTestingHarness.create();
    const nav = h.navigateByUrl(`/knowledge-bases/${KB_ID}`);
    const req = await vi.waitFor(() => {
      const [r] = ctrl.match(URL_);
      if (!r) throw new Error('no request yet');
      return r;
    });
    req.flush(makeKb({ myRole: role, ...over }), { headers: { ETag: etag } });
    await nav;
    await stable();
  }

  async function editName(value: string) {
    q('edit')!.click();
    await stable();
    const i = el().querySelector<HTMLInputElement>('input[formControlName="name"]')!;
    i.value = value;
    i.dispatchEvent(new Event('input'));
    await stable();
    q('save')!.click();
    await stable();
  }

  it('KbDetail_ShowsHeader_NameDescriptionRole', async () => {
    await load('Owner');
    expect(q('kb-name')!.textContent).toContain('HR handbook');
    expect(q('kb-description')!.textContent).toContain('Policies and onboarding');
    expect(el().textContent).toContain('Your role: Owner');
  });

  it('KbDetail_Update_SendsIfMatch_AndStoresNewEtag', async () => {
    await load('Owner', {}, '"v1"');
    await editName('Renamed');
    let req = ctrl.expectOne(URL_);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('"v1"');
    expect(req.request.body).toEqual({ name: 'Renamed', description: 'Policies and onboarding' });
    expect(q<HTMLButtonElement>('save')!.disabled).toBe(true); // pending
    req.flush(makeKb({ name: 'Renamed' }), { headers: { ETag: '"v2"' } });
    await stable();
    expect(q('kb-name')!.textContent).toContain('Renamed');

    await editName('Renamed again');
    req = ctrl.expectOne(URL_);
    expect(req.request.headers.get('If-Match')).toBe('"v2"');
    req.flush(makeKb({ name: 'Renamed again' }), { headers: { ETag: '"v3"' } });
  });

  it('KbDetail_Update_WhitespaceName_Invalid', async () => {
    await load('Owner');
    await editName('   ');
    ctrl.expectNone(URL_);
    expect(el().textContent).toContain('Enter a name.');
  });

  it('KbDetail_Update_412_ShowsReloadFlow', async () => {
    await load('Owner', {}, '"v1"');
    await editName('Mine');
    ctrl.expectOne(URL_).flush(problemBody(412, PROBLEM_TYPES.preconditionFailed), {
      status: 412,
      statusText: 'Precondition Failed',
    });
    await stable();
    expect(q('changed-banner')!.textContent).toContain('changed elsewhere');
    expect(q('changed-banner')!.textContent).not.toContain('SERVER DETAIL');

    q('reload')!.click();
    await stable();
    const get = ctrl.expectOne(URL_);
    expect(get.request.method).toBe('GET');
    get.flush(makeKb({ name: 'Fresh' }), { headers: { ETag: '"v9"' } });
    await stable();
    expect(q('changed-banner')).toBeNull();
    expect(q('kb-name')!.textContent).toContain('Fresh');
    expect(el().querySelector<HTMLInputElement>('input[formControlName="name"]')!.value).toBe(
      'Fresh',
    );

    q('save')!.click();
    await stable();
    const put = ctrl.expectOne(URL_);
    expect(put.request.headers.get('If-Match')).toBe('"v9"');
    put.flush(makeKb({ name: 'Fresh' }), { headers: { ETag: '"v10"' } });
  });

  it('KbDetail_Update_428_ShowsGenericErrorAndReload', async () => {
    await load('Owner');
    await editName('Mine');
    ctrl.expectOne(URL_).flush(problemBody(428, PROBLEM_TYPES.preconditionRequired), {
      status: 428,
      statusText: 'x',
    });
    await stable();
    expect(q('changed-banner')).not.toBeNull();
    expect(q('reload')).not.toBeNull();
  });

  it('KbDetail_Update_403_ShowsForbiddenAndHidesActions', async () => {
    await load('Owner');
    await editName('Mine');
    ctrl
      .expectOne(URL_)
      .flush(problemBody(403, PROBLEM_TYPES.forbidden), { status: 403, statusText: 'x' });
    await stable();
    expect(el().textContent).toContain('You do not have permission to do this.');
    expect(q('edit')).toBeNull();
    expect(q('delete')).toBeNull();
  });

  it('KbDetail_404_ShowsNotFound_SameAsMissing', async () => {
    configure();
    h = await RouterTestingHarness.create();
    const nav = h.navigateByUrl(`/knowledge-bases/${KB_ID}`);
    const req = await vi.waitFor(() => {
      const [r] = ctrl.match(URL_);
      if (!r) throw new Error('no request yet');
      return r;
    });
    req.flush(problemBody(404, PROBLEM_TYPES.notFound), { status: 404, statusText: 'Not Found' });
    await nav;
    await stable();
    expect(el().textContent).toContain('Page not found');
    expect(q('kb-name')).toBeNull();
  });

  it('Detail_NotFoundAndForbiddenLookIdentical', async () => {
    configure();
    h = await RouterTestingHarness.create();
    const render = async (status: number, type: string, id: string) => {
      const url = `/api/knowledge-bases/${id}`;
      const nav = h.navigateByUrl(`/knowledge-bases/${id}`);
      const req = await vi.waitFor(() => {
        const [r] = ctrl.match(url);
        if (!r) throw new Error('no request yet');
        return r;
      });
      req.flush(problemBody(status, type, `cid-${status}`), { status, statusText: 'x' });
      await nav;
      await stable();
      return el()
        .outerHTML.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/_ngcontent-[a-z0-9-]+="[^"]*"/g, '');
    };
    const notFound = await render(404, PROBLEM_TYPES.notFound, 'aaa');
    const forbidden = await render(403, PROBLEM_TYPES.forbidden, 'bbb');
    expect(forbidden).toBe(notFound);
    expect(forbidden).not.toContain('cid-');
  });

  it('KbDetail_Viewer_HidesOwnerActions', async () => {
    await load('Viewer');
    expect(q('kb-name')).not.toBeNull();
    expect(q('edit')).toBeNull();
    expect(q('delete')).toBeNull();
  });

  it('Detail_Editor_HidesOwnerActions', async () => {
    await load('Editor');
    expect(q('edit')).toBeNull();
    expect(q('delete')).toBeNull();
  });

  it('KbDetail_Delete_Confirms_ThenNavigates', async () => {
    await load('Owner');
    const dialog = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of(true),
    } as never);
    const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockReturnValue({} as never);
    q('delete')!.click();
    await stable();
    expect(dialog).toHaveBeenCalledTimes(1);
    const del = ctrl.expectOne(URL_);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/knowledge-bases'));
    expect(snack).toHaveBeenCalledWith('Knowledge base deleted.', undefined, expect.anything());
    ctrl.match((r) => r.url === '/api/knowledge-bases'); // the list page's own load
  });

  it('KbDetail_Delete_Declined_DoesNothing', async () => {
    await load('Owner');
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of(false),
    } as never);
    q('delete')!.click();
    await stable();
    ctrl.expectNone(URL_);
    expect(TestBed.inject(Router).url).toBe(`/knowledge-bases/${KB_ID}`);
  });

  it('KbName_WithScriptTag_RendersAsText', async () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    await load('Owner', { name: evil, description: evil });
    expect(q('kb-name')!.textContent).toContain(evil);
    expect(q('kb-description')!.textContent).toContain(evil);
    expect(el().querySelector('script')).toBeNull();
    expect(el().querySelector('img')).toBeNull();
  });

  async function openMembersTab() {
    el().querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    await stable();
    ctrl
      .expectOne(`${URL_}/members`)
      .flush([
        makeMember({ userId: 'u-owner', displayName: 'Ada', role: 'Owner' }),
        makeMember({ userId: 'u-2', displayName: 'Grace', role: 'Editor' }),
      ]);
    await stable();
  }
  const rejectRoleChange = async (status: number, type: string) => {
    el()
      .querySelectorAll<HTMLElement>('[data-testid="role-select"] .mat-mdc-select-trigger')[1]
      .click();
    await stable();
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find((o) => o.textContent?.includes('Viewer'))!
      .click();
    await stable();
    ctrl
      .expectOne(`${URL_}/members/u-2`)
      .flush(problemBody(status, type), { status, statusText: 'x' });
    await stable();
  };

  it('Members_DemotedWhileViewing_ShowsForbidden_AndControlsDisappear', async () => {
    await load('Owner');
    await openMembersTab();
    expect(el().querySelectorAll('[data-testid="remove-member"]').length).toBe(2);

    // Someone demoted us to Editor meanwhile: the PUT is refused.
    await rejectRoleChange(403, PROBLEM_TYPES.forbidden);
    expect(el().querySelector('[data-testid="members-error"]')!.textContent).toContain(
      'You do not have permission to do this.',
    );
    // The detail page re-reads the KB and adopts the new role.
    ctrl.expectOne(URL_).flush(makeKb({ myRole: 'Editor' }), { headers: { ETag: '"v2"' } });
    await stable();

    expect(el().querySelector('[data-testid="remove-member"]')).toBeNull();
    expect(el().querySelector('[data-testid="role-select"]')).toBeNull();
    expect(el().querySelector('[data-testid="add-member"]')).toBeNull();
    expect(q('edit')).toBeNull();
    expect(el().textContent).toContain('Your role: Editor');
    expect(el().textContent).toContain('Only owners can change members.');
  });

  it('Members_KbGoneWhileViewing_404_ShowsNotFoundPage', async () => {
    await load('Owner');
    await openMembersTab();
    await rejectRoleChange(404, PROBLEM_TYPES.notFound);
    // Member list reload and KB re-read both 404: the KB is gone.
    for (const r of ctrl.match((req) => req.url.startsWith(URL_))) {
      r.flush(problemBody(404, PROBLEM_TYPES.notFound), { status: 404, statusText: 'x' });
    }
    await stable();
    expect(el().textContent).toContain('Page not found');
  });

  it('Members_ChangeRole_And_Remove_RefreshEtag', async () => {
    await load('Owner', {}, '"v1"');
    const members = [
      makeMember({ userId: 'u-owner', displayName: 'Ada', role: 'Owner' }),
      makeMember({ userId: 'u-2', displayName: 'Grace', role: 'Editor' }),
    ];
    el().querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    await stable();
    ctrl.expectOne(`${URL_}/members`).flush(members);
    await stable();

    // change role -> server touches the KB row -> detail re-GETs and stores the new ETag
    const trigger = el().querySelectorAll<HTMLElement>(
      '[data-testid="role-select"] .mat-mdc-select-trigger',
    )[1];
    trigger.click();
    await stable();
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find((o) => o.textContent?.includes('Viewer'))!
      .click();
    await stable();
    ctrl.expectOne(`${URL_}/members/u-2`).flush({ ...members[1], role: 'Viewer' });
    await stable();
    ctrl.expectOne(`${URL_}/members`).flush(members);
    await stable();
    ctrl.expectOne(URL_).flush(makeKb(), { headers: { ETag: '"v2"' } });
    await stable();

    // remove -> again a re-GET with another ETag
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of(true),
    } as never);
    el().querySelectorAll<HTMLButtonElement>('[data-testid="remove-member"]')[1].click();
    await stable();
    ctrl.expectOne(`${URL_}/members/u-2`).flush(null, { status: 204, statusText: 'No Content' });
    await stable();
    ctrl.expectOne(`${URL_}/members`).flush([members[0]]);
    await stable();
    ctrl.expectOne(URL_).flush(makeKb(), { headers: { ETag: '"v3"' } });
    await stable();

    // the next update must use the latest ETag
    el().querySelectorAll<HTMLElement>('[role="tab"]')[0].click();
    await stable();
    await editName('After members');
    expect(ctrl.expectOne(URL_).request.headers.get('If-Match')).toBe('"v3"');
  });

  it('UserNames_AreBidiIsolated (kb detail header)', async () => {
    await load('Owner');
    expect(isolatedTexts(q('kb-name')!)).toContain('HR handbook');
    expect(isolatedTexts(q('kb-description')!)).toContain('Policies and onboarding');
  });
});
