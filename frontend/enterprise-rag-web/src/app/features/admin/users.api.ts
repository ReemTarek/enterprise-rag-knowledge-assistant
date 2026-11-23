import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../core/api/api-client.service';
import {
  AdminUser,
  CreateUserBody,
  CreatedUser,
  Paged,
  ResetPasswordResult,
} from './users.models';

const BASE = '/api/admin/users';

/** Admin user-management endpoints (docs/API_DESIGN.md). Errors arrive as ApiError. */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly api = inject(ApiClientService);

  list(page: number, pageSize: number): Observable<Paged<AdminUser>> {
    return this.api.get<Paged<AdminUser>>(BASE, { params: { page, pageSize } });
  }

  create(body: CreateUserBody): Observable<CreatedUser> {
    return this.api.post<CreatedUser>(BASE, body);
  }

  deactivate(id: string): Observable<void> {
    return this.api.post<void>(`${BASE}/${encodeURIComponent(id)}/deactivate`, {});
  }

  resetPassword(id: string): Observable<ResetPasswordResult> {
    return this.api.post<ResetPasswordResult>(`${BASE}/${encodeURIComponent(id)}/reset-password`, {});
  }
}
