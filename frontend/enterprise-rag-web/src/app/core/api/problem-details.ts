/** RFC 7807 / 9457 body the API returns for every error (see docs/API_DESIGN.md "Error format"). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}

/** Prefix of every server problem type (src/EnterpriseRag.API/Http/ProblemTypes.cs `Base`). */
export const PROBLEM_TYPE_BASE = 'https://enterprise-rag.local/problems/';

/** Exact copies of the URIs in src/EnterpriseRag.API/Http/ProblemTypes.cs. Clients branch on these, never on title. */
export const PROBLEM_TYPES = {
  validation: 'https://enterprise-rag.local/problems/validation',
  badRequest: 'https://enterprise-rag.local/problems/bad-request',
  businessRule: 'https://enterprise-rag.local/problems/business-rule',
  unauthorized: 'https://enterprise-rag.local/problems/unauthorized',
  forbidden: 'https://enterprise-rag.local/problems/forbidden',
  passwordChangeRequired: 'https://enterprise-rag.local/problems/password-change-required',
  notFound: 'https://enterprise-rag.local/problems/not-found',
  conflict: 'https://enterprise-rag.local/problems/conflict',
  preconditionFailed: 'https://enterprise-rag.local/problems/precondition-failed',
  preconditionRequired: 'https://enterprise-rag.local/problems/precondition-required',
  tooManyRequests: 'https://enterprise-rag.local/problems/too-many-requests',
  internalError: 'https://enterprise-rag.local/problems/internal-error',
} as const;

/** Client-side type for a request that never got an HTTP response (offline, DNS, CORS, aborted by the network). */
export const NETWORK_ERROR_TYPE = 'network';

/** Mirrors ProblemTypes.ForStatus: the type the server uses when a body carries none. */
export function problemTypeForStatus(status: number): string {
  switch (status) {
    case 400:
      return PROBLEM_TYPES.badRequest;
    case 401:
      return PROBLEM_TYPES.unauthorized;
    case 403:
      return PROBLEM_TYPES.forbidden;
    case 404:
      return PROBLEM_TYPES.notFound;
    case 409:
      return PROBLEM_TYPES.conflict;
    case 412:
      return PROBLEM_TYPES.preconditionFailed;
    case 428:
      return PROBLEM_TYPES.preconditionRequired;
    case 429:
      return PROBLEM_TYPES.tooManyRequests;
    case 500:
      return PROBLEM_TYPES.internalError;
    default:
      return `${PROBLEM_TYPE_BASE}http-${status}`;
  }
}
