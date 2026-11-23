import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UsersApi } from './users.api';
import { USER_ID, makeAdminUser } from './users.testing';

describe('UsersApi', () => {
  let api: UsersApi;
  let ctrl: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(UsersApi);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('UsersApi_List_SendsPagingParams', () => {
    let result: unknown;
    api.list(2, 25).subscribe((r) => (result = r));
    const req = ctrl.expectOne((r) => r.url === '/api/admin/users');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    const body = { items: [makeAdminUser()], page: 2, pageSize: 25, totalCount: 26 };
    req.flush(body);
    expect(result).toEqual(body);
  });

  it('UsersApi_Create_PostsEnumNameString', () => {
    let result: unknown;
    api
      .create({ email: 'a@b.co', displayName: 'A B', globalRole: 'Admin' })
      .subscribe((r) => (result = r));
    const req = ctrl.expectOne('/api/admin/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.co', displayName: 'A B', globalRole: 'Admin' });
    expect(typeof req.request.body.globalRole).toBe('string');
    req.flush({ id: USER_ID, email: 'a@b.co', temporaryPassword: 'x' }, { status: 201, statusText: 'Created' });
    expect(result).toEqual({ id: USER_ID, email: 'a@b.co', temporaryPassword: 'x' });
  });

  it('UsersApi_Deactivate_PostsToIdRoute', () => {
    let done = false;
    api.deactivate(USER_ID).subscribe(() => (done = true));
    const req = ctrl.expectOne(`/api/admin/users/${USER_ID}/deactivate`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });

  it('UsersApi_ResetPassword_PostsAndReturnsTemporaryPassword', () => {
    let result: unknown;
    api.resetPassword(USER_ID).subscribe((r) => (result = r));
    const req = ctrl.expectOne(`/api/admin/users/${USER_ID}/reset-password`);
    expect(req.request.method).toBe('POST');
    req.flush({ temporaryPassword: 'pw' });
    expect(result).toEqual({ temporaryPassword: 'pw' });
  });

  it('UsersApi_EncodesIdInPath', () => {
    api.deactivate('a/b').subscribe();
    ctrl.expectOne('/api/admin/users/a%2Fb/deactivate').flush(null, { status: 204, statusText: 'No Content' });
  });
});
