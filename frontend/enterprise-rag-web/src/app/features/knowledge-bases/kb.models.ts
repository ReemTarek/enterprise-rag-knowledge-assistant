import { DirectoryUser } from '../../shared/user-picker/directory-user';

export type { DirectoryUser };

/** Role strings exactly as the API sends them (docs/API_DESIGN.md). */
export const KB_ROLES = ['Viewer', 'Editor', 'Owner'] as const;
export type KbRole = (typeof KB_ROLES)[number];

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  myRole: KbRole;
  createdAt: string;
  updatedAt: string;
  rowVersion: string;
}

/** The list endpoint returns the same DTO as the single-KB endpoints. */
export type KnowledgeBaseSummary = KnowledgeBase;

export interface KbMember {
  userId: string;
  displayName: string;
  email: string;
  role: KbRole;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface KbWithEtag {
  kb: KnowledgeBase;
  /** Raw `ETag` response header (strong, quoted); sent back verbatim as `If-Match`. */
  etag: string;
}

export interface KbWriteBody {
  name: string;
  description?: string | null;
}

export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const DIRECTORY_MIN_QUERY = 2;
export const DIRECTORY_MAX_QUERY = 100;
