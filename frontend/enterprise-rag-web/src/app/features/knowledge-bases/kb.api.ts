import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiClientService } from '../../core/api/api-client.service';
import { DirectoryUser } from '../../shared/user-picker/directory-user';
import {
  KbMember,
  KbRole,
  KbWithEtag,
  KbWriteBody,
  KnowledgeBase,
  KnowledgeBaseSummary,
  Paged,
} from './kb.models';

const BASE = '/api/knowledge-bases';

/** Knowledge-base, membership and user-directory endpoints (docs/API_DESIGN.md). Errors arrive as ApiError. */
@Injectable({ providedIn: 'root' })
export class KbApi {
  private readonly api = inject(ApiClientService);

  list(page: number, pageSize: number): Observable<Paged<KnowledgeBaseSummary>> {
    return this.api.get<Paged<KnowledgeBaseSummary>>(BASE, { params: { page, pageSize } });
  }

  get(id: string): Observable<KbWithEtag> {
    return this.api.getResponse<KnowledgeBase>(this.url(id)).pipe(map(withEtag));
  }

  create(body: KbWriteBody): Observable<KbWithEtag> {
    return this.api.postResponse<KnowledgeBase>(BASE, body).pipe(map(withEtag));
  }

  /** `etag` is sent verbatim as `If-Match` (the value received from the server, quotes included). */
  update(id: string, body: KbWriteBody, etag: string): Observable<KbWithEtag> {
    return this.api
      .putResponse<KnowledgeBase>(this.url(id), body, { ifMatch: etag })
      .pipe(map(withEtag));
  }

  delete(id: string): Observable<void> {
    return this.api.delete(this.url(id));
  }

  members(id: string): Observable<KbMember[]> {
    return this.api.get<KbMember[]>(`${this.url(id)}/members`);
  }

  addMember(id: string, userId: string, role: KbRole): Observable<KbMember> {
    return this.api.post<KbMember>(`${this.url(id)}/members`, { userId, role });
  }

  changeRole(id: string, userId: string, role: KbRole): Observable<KbMember> {
    return this.api.put<KbMember>(`${this.url(id)}/members/${encodeURIComponent(userId)}`, {
      role,
    });
  }

  removeMember(id: string, userId: string): Observable<void> {
    return this.api.delete(`${this.url(id)}/members/${encodeURIComponent(userId)}`);
  }

  searchUsers(query: string): Observable<DirectoryUser[]> {
    return this.api.get<DirectoryUser[]>('/api/users/directory', { params: { query } });
  }

  private url(id: string): string {
    return `${BASE}/${encodeURIComponent(id)}`;
  }
}

function withEtag(res: HttpResponse<KnowledgeBase>): KbWithEtag {
  const kb = res.body;
  if (!kb) throw new Error('Empty knowledge-base response');
  // Prefer the header exactly as sent; the body's rowVersion is the same value, so quote it if the header is absent.
  return { kb, etag: res.headers.get('ETag') ?? `"${kb.rowVersion}"` };
}
