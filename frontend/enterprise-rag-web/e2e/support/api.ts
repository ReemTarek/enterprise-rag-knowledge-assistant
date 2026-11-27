import { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Thin typed client for the public API (docs/API_DESIGN.md), used to create test data. Always goes through the
 * Angular dev-server proxy origin (same origin as the app), so the refresh cookie lands on `localhost` exactly as in
 * the browser. The access token is kept in memory (bearer); the refresh cookie lives in the request context's jar.
 *
 * Rate limits (per client IP, fixed 1-minute window): login + password change share 10/min, refresh + logout 30/min.
 * Every local client shares one bucket, so on 429 the client waits for `Retry-After` and retries (bounded) instead
 * of failing the test. Specs should still create few users (each costs 2 login-bucket permits).
 */

export type GlobalRole = 'User' | 'Admin';
export type KbRole = 'Viewer' | 'Editor' | 'Owner';

export interface TokenResponse {
  accessToken: string;
  expiresAtUtc: string;
  mustChangePassword: boolean;
}

export interface CreatedUser {
  id: string;
  email: string;
  temporaryPassword: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  mustChangePassword: boolean;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  myRole: KbRole;
  createdAt: string;
  updatedAt: string | null;
  rowVersion: string;
}

export interface KbMember {
  userId: string;
  displayName: string;
  email: string;
  role: KbRole;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    // The body is a ProblemDetails document (never contains passwords: the API does not echo attempted values).
    super(`${what} failed with HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

/** Longest single wait for a rate-limit window, and how many times a request is retried on 429. */
const MAX_RETRY_AFTER_S = 65;
const MAX_429_RETRIES = 3;

export class ApiClient {
  private accessToken: string | null = null;

  /** Credentials for one automatic re-login when a bearer call answers 401 (expired access token). */
  private relogin: { email: string; password: string } | null = null;

  constructor(readonly request: APIRequestContext) {}

  /**
   * For long-lived (worker-scoped) clients: on a 401 from an authenticated call, sign in again ONCE and repeat the
   * call. A second 401 is returned as is (no loop).
   */
  reloginOn401(email: string, password: string): void {
    this.relogin = { email, password };
  }

  get token(): string | null {
    return this.accessToken;
  }

  /** POST /api/auth/login. Returns the HTTP status; on 200 stores the access token (cookie goes to the jar). */
  async tryLogin(
    email: string,
    password: string,
  ): Promise<{ status: number; session?: TokenResponse }> {
    const res = await this.send('POST', '/api/auth/login', {
      data: { email, password },
      auth: false,
    });
    if (res.status() !== 200) return { status: res.status() };
    const session = (await res.json()) as TokenResponse;
    this.accessToken = session.accessToken;
    return { status: 200, session };
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    const { status, session } = await this.tryLogin(email, password);
    if (!session) throw new ApiError(status, '', `login as ${email}`);
    return session;
  }

  /** POST /api/auth/password (keeps this client's session: the refresh cookie identifies it). */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.expectStatus('POST', '/api/auth/password', 204, 'change password', {
      data: { currentPassword, newPassword },
    });
  }

  /** POST /api/auth/refresh with the jar's cookie; rotates the cookie. */
  async refresh(): Promise<TokenResponse> {
    const res = await this.send('POST', '/api/auth/refresh', { auth: false });
    if (res.status() !== 200) throw new ApiError(res.status(), await res.text(), 'refresh');
    const session = (await res.json()) as TokenResponse;
    this.accessToken = session.accessToken;
    return session;
  }

  async logout(): Promise<void> {
    await this.expectStatus('POST', '/api/auth/logout', 204, 'logout', { auth: false });
    this.accessToken = null;
  }

  async me(): Promise<CurrentUser> {
    return this.json<CurrentUser>('GET', '/api/me', 200, 'get /api/me');
  }

  async createUser(input: {
    email: string;
    displayName: string;
    globalRole: GlobalRole;
  }): Promise<CreatedUser> {
    return this.json<CreatedUser>('POST', '/api/admin/users', 201, 'create user', { data: input });
  }

  async deactivateUser(id: string): Promise<void> {
    await this.expectStatus('POST', `/api/admin/users/${id}/deactivate`, 204, 'deactivate user');
  }

  async resetPassword(id: string): Promise<string> {
    const body = await this.json<{ temporaryPassword: string }>(
      'POST',
      `/api/admin/users/${id}/reset-password`,
      200,
      'reset password',
    );
    return body.temporaryPassword;
  }

  async createKb(input: { name: string; description?: string }): Promise<KnowledgeBase> {
    return this.json<KnowledgeBase>('POST', '/api/knowledge-bases', 201, 'create knowledge base', {
      data: input,
    });
  }

  async getKb(id: string): Promise<KnowledgeBase> {
    return this.json<KnowledgeBase>('GET', `/api/knowledge-bases/${id}`, 200, 'get knowledge base');
  }

  async updateKb(
    kb: Pick<KnowledgeBase, 'id' | 'rowVersion'>,
    input: { name: string; description?: string },
  ) {
    return this.json<KnowledgeBase>(
      'PUT',
      `/api/knowledge-bases/${kb.id}`,
      200,
      'update knowledge base',
      {
        data: input,
        headers: { 'If-Match': `"${kb.rowVersion}"` },
      },
    );
  }

  async deleteKb(id: string): Promise<void> {
    await this.expectStatus('DELETE', `/api/knowledge-bases/${id}`, 204, 'delete knowledge base');
  }

  async addMember(kbId: string, userId: string, role: KbRole): Promise<KbMember> {
    return this.json<KbMember>('POST', `/api/knowledge-bases/${kbId}/members`, 201, 'add member', {
      data: { userId, role },
    });
  }

  async setMemberRole(kbId: string, userId: string, role: KbRole): Promise<KbMember> {
    return this.json<KbMember>(
      'PUT',
      `/api/knowledge-bases/${kbId}/members/${userId}`,
      200,
      'change member role',
      {
        data: { role },
      },
    );
  }

  async removeMember(kbId: string, userId: string): Promise<void> {
    await this.expectStatus(
      'DELETE',
      `/api/knowledge-bases/${kbId}/members/${userId}`,
      204,
      'remove member',
    );
  }

  // --- plumbing -------------------------------------------------------------------------------------------------

  private async json<T>(
    method: string,
    url: string,
    expected: number,
    what: string,
    opts: SendOptions = {},
  ) {
    const res = await this.send(method, url, opts);
    if (res.status() !== expected) throw new ApiError(res.status(), await res.text(), what);
    return (await res.json()) as T;
  }

  private async expectStatus(
    method: string,
    url: string,
    expected: number,
    what: string,
    opts: SendOptions = {},
  ) {
    const res = await this.send(method, url, opts);
    if (res.status() !== expected) throw new ApiError(res.status(), await res.text(), what);
  }

  private async send(method: string, url: string, opts: SendOptions): Promise<APIResponse> {
    const res = await this.sendOnce(method, url, opts);
    if (res.status() !== 401 || opts.auth === false || !this.relogin) return res;
    await this.login(this.relogin.email, this.relogin.password);
    return this.sendOnce(method, url, opts);
  }

  private async sendOnce(method: string, url: string, opts: SendOptions): Promise<APIResponse> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.auth !== false) {
      if (!this.accessToken) throw new Error(`${method} ${url}: not signed in (call login first).`);
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.request.fetch(url, {
        method,
        data: opts.data,
        headers,
        failOnStatusCode: false,
      });
      if (res.status() !== 429 || attempt >= MAX_429_RETRIES) return res;
      const retryAfter = Math.min(
        Number(res.headers()['retry-after'] ?? '5') || 5,
        MAX_RETRY_AFTER_S,
      );
      // Rate-limit backoff in test-data setup only (never used to wait for UI state).
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
    }
  }
}

interface SendOptions {
  data?: unknown;
  headers?: Record<string, string>;
  /** false for anonymous endpoints (login, refresh, logout). */
  auth?: boolean;
}
