import { request } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { ApiClient, GlobalRole } from './api';
import { loadEnv } from './env';
import { uniqueSuffix } from './unique';

/** Storage state of a signed-in session (the refresh cookie for the proxy origin). */
export type SessionState = Awaited<ReturnType<ApiClient['request']['storageState']>>;

export interface UserCredentials {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly globalRole: GlobalRole;
}

/** An active user plus the signed-in session that changed the password (usable once by one browser context). */
export interface ActiveUser extends UserCredentials {
  readonly session: SessionState;
}

/** `<prefix>-<runId>-w<workerIndex>-<n>-<random>@e2e.test`: unique across worker restarts (see unique.ts). */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${uniqueSuffix()}@e2e.test`.toLowerCase();
}

/** Strong random password that satisfies the policy (length >= 12, upper, lower, digit). */
export function strongPassword(): string {
  return `Aa1!${randomBytes(18).toString('base64url')}`;
}

/** A fresh, cookie-isolated API client against the proxy origin. Dispose its `request` when done. */
export async function newApiClient(): Promise<ApiClient> {
  return new ApiClient(await request.newContext({ baseURL: loadEnv().baseUrl }));
}

/**
 * Admin creates the user (temporary password) -> the user signs in with it -> changes it (forced change) -> returns
 * the final credentials and the user's signed-in session. Costs 2 permits of the shared login bucket (10/min/IP).
 */
export async function createActiveUser(
  admin: ApiClient,
  options: { role?: GlobalRole; displayName?: string; email?: string } = {},
): Promise<ActiveUser> {
  const globalRole = options.role ?? 'User';
  const email = options.email ?? uniqueEmail(globalRole === 'Admin' ? 'admin' : 'user');
  const displayName = options.displayName ?? `E2E ${globalRole} ${email.split('@')[0]}`;
  const created = await admin.createUser({ email, displayName, globalRole });

  const client = await newApiClient();
  try {
    const session = await client.login(email, created.temporaryPassword);
    if (!session.mustChangePassword)
      throw new Error(`New user ${email} was not asked to change the password.`);
    const password = strongPassword();
    await client.changePassword(created.temporaryPassword, password);
    return {
      id: created.id,
      email,
      password,
      displayName,
      globalRole,
      session: await client.request.storageState(),
    };
  } finally {
    await client.request.dispose();
  }
}

/** A user that still has to change the temporary password (for forced-change specs). */
export async function createPendingUser(
  admin: ApiClient,
  options: { role?: GlobalRole; displayName?: string } = {},
): Promise<UserCredentials> {
  const globalRole = options.role ?? 'User';
  const email = uniqueEmail('pending');
  const displayName = options.displayName ?? `E2E pending ${email.split('@')[0]}`;
  const created = await admin.createUser({ email, displayName, globalRole });
  return { id: created.id, email, password: created.temporaryPassword, displayName, globalRole };
}
