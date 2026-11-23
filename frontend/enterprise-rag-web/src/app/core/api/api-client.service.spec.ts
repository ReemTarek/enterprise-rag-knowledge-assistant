import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiClientService } from './api-client.service';

describe('ApiClientService', () => {
  let api: ApiClientService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClientService);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('ApiClient_UsesCredentials_OnlyForAuthEndpoints', () => {
    api.post('/api/auth/login', { email: 'a@b.c' }).subscribe();
    api.get('/api/me').subscribe();
    api.post('/api/authors', {}).subscribe();

    expect(ctrl.expectOne('/api/auth/login').request.withCredentials).toBe(true);
    expect(ctrl.expectOne('/api/me').request.withCredentials).toBe(false);
    expect(ctrl.expectOne('/api/authors').request.withCredentials).toBe(false);
  });

  it('ApiClient_SendsMethodBodyParamsAndIfMatch', () => {
    let got: unknown;
    api
      .get<{ items: number[] }>('/api/knowledge-bases', { params: { page: 2, pageSize: 20 } })
      .subscribe((r) => (got = r));
    const get = ctrl.expectOne((r) => r.url === '/api/knowledge-bases');
    expect(get.request.method).toBe('GET');
    expect(get.request.params.get('page')).toBe('2');
    get.flush({ items: [1] });
    expect(got).toEqual({ items: [1] });

    api.put('/api/knowledge-bases/1', { name: 'x' }, { ifMatch: '"AAAA"' }).subscribe();
    const put = ctrl.expectOne('/api/knowledge-bases/1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ name: 'x' });
    expect(put.request.headers.get('If-Match')).toBe('"AAAA"');

    api.delete('/api/knowledge-bases/1', { ifMatch: '"BBBB"' }).subscribe();
    const del = ctrl.expectOne((r) => r.method === 'DELETE');
    expect(del.request.headers.get('If-Match')).toBe('"BBBB"');

    api.patch('/api/x', { a: 1 }).subscribe();
    const patch = ctrl.expectOne('/api/x');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.headers.has('If-Match')).toBe(false);
  });
});
