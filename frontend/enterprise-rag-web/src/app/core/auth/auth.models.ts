/** `GlobalRole` enum names as the API serialises them (strings only). */
export type GlobalRole = 'User' | 'Admin';

/** 200 body of `POST /api/auth/login` and `POST /api/auth/refresh`. */
export interface TokenResponse {
  accessToken: string;
  expiresAtUtc: string;
  mustChangePassword: boolean;
}

/** 200 body of `GET /api/me`. */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  mustChangePassword: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
