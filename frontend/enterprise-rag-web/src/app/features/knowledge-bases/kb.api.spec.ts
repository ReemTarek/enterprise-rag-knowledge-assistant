import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { KbApi } from './kb.api';
import { KnowledgeBase } from './kb.models';

const ID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const kb = (over: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: ID,
  name: 'HR',
  description: null,
  myRole: 'Owner',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  rowVersion: 'AAAAAAAAB9E=',
  ...over,
});

describe('KbApi', () => {
  let api: KbApi;
  let ctrl: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(KbApi);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  it('KbApi_List_SendsPagingParams', () => {
    let result: unknown;
    api.list(2, 25).subscribe((r) => (result = r));
    const req = ctrl.expectOne((r) => r.url === '/api/knowledge-bases');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush({ items: [kb()], page: 2, pageSize: 25, totalCount: 26 });
    expect(result).toEqual({ items: [kb()], page: 2, pageSize: 25, totalCount: 26 });
  });

  it('KbApi_Get_ReadsEtagHeader', () => {
    let result: { etag: string } | undefined;
    api.get(ID).subscribe((r) => (result = r));
    ctrl.expectOne(`/api/knowledge-bases/${ID}`).flush(kb(), { headers: { ETag: '"hdr-etag"' } });
    expect(result?.etag).toBe('"hdr-etag"');
  });

  it('KbApi_Get_FallsBackToQuotedRowVersion_WhenHeaderMissing', () => {
    let result: { etag: string } | undefined;
    api.get(ID).subscribe((r) => (result = r));
    ctrl.expectOne(`/api/knowledge-bases/${ID}`).flush(kb());
    expect(result?.etag).toBe('"AAAAAAAAB9E="');
  });

  it('KbApi_Create_PostsBody_ReturnsEtag', () => {
    let result: { etag: string } | undefined;
    api.create({ name: 'HR', description: 'd' }).subscribe((r) => (result = r));
    const req = ctrl.expectOne('/api/knowledge-bases');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'HR', description: 'd' });
    req.flush(kb(), { status: 201, statusText: 'Created', headers: { ETag: '"e1"' } });
    expect(result?.etag).toBe('"e1"');
  });

  it('KbApi_Update_SendsIfMatchExactly_AndReturnsNewEtag', () => {
    let result: { etag: string } | undefined;
    api.update(ID, { name: 'HR2' }, '"old-etag=="').subscribe((r) => (result = r));
    const req = ctrl.expectOne(`/api/knowledge-bases/${ID}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('"old-etag=="');
    expect(req.request.body).toEqual({ name: 'HR2' });
    req.flush(kb({ name: 'HR2' }), { headers: { ETag: '"new"' } });
    expect(result?.etag).toBe('"new"');
  });

  it('KbApi_Delete_SendsDelete', () => {
    api.delete(ID).subscribe();
    const req = ctrl.expectOne(`/api/knowledge-bases/${ID}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('KbApi_Members_Endpoints', () => {
    api.members(ID).subscribe();
    ctrl.expectOne(`/api/knowledge-bases/${ID}/members`).flush([]);

    api.addMember(ID, UID, 'Editor').subscribe();
    let req = ctrl.expectOne(`/api/knowledge-bases/${ID}/members`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: UID, role: 'Editor' });
    req.flush({ userId: UID, displayName: 'A', email: 'a@x.io', role: 'Editor' });

    api.changeRole(ID, UID, 'Owner').subscribe();
    req = ctrl.expectOne(`/api/knowledge-bases/${ID}/members/${UID}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ role: 'Owner' });
    req.flush({ userId: UID, displayName: 'A', email: 'a@x.io', role: 'Owner' });

    api.removeMember(ID, UID).subscribe();
    req = ctrl.expectOne(`/api/knowledge-bases/${ID}/members/${UID}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('KbApi_SearchUsers_UsesQueryParam', () => {
    api.searchUsers('ad a').subscribe();
    const req = ctrl.expectOne((r) => r.url === '/api/users/directory');
    expect(req.request.params.get('query')).toBe('ad a');
    req.flush([]);
  });
});
