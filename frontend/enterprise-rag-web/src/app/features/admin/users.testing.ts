import { AdminUser } from './users.models';

export const USER_ID = '33333333-3333-4333-8333-333333333333';
export const TEMP_PASSWORD = 'Tmp-Pa55!w0rd-XyZ-9137';

export function makeAdminUser(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: USER_ID,
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    globalRole: 'User',
    isActive: true,
    mustChangePassword: false,
    lockoutEndUtc: null,
    ...over,
  };
}
