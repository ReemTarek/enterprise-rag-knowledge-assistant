import { Paged } from '../knowledge-bases/kb.models';

export type { Paged };

/** Global role names exactly as the API sends and accepts them (integers are rejected by the server). */
export const GLOBAL_ROLES = ['User', 'Admin'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

/** `GET /api/admin/users` item (docs/API_DESIGN.md "Admin users"). */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lockoutEndUtc: string | null;
}

export interface CreateUserBody {
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

export interface CreatedUser {
  id: string;
  email: string;
  temporaryPassword: string;
}

/** What the create dialog hands back: the API result plus the display name that was entered. */
export type CreatedUserResult = CreatedUser & { displayName: string };

export interface ResetPasswordResult {
  temporaryPassword: string;
}

export const EMAIL_MAX_LENGTH = 256;
export const DISPLAY_NAME_MAX_LENGTH = 200;
