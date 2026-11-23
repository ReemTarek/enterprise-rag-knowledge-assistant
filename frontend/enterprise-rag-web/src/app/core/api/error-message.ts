import { ApiError } from './api-error';
import { NETWORK_ERROR_TYPE, PROBLEM_TYPES } from './problem-details';

/**
 * Translation key for an ApiError, chosen from the problem `type` (never status text, never the server `detail`).
 * Unknown types fall back to `errors.generic`.
 */
export function messageKeyFor(error: ApiError): string {
  switch (error.type) {
    case PROBLEM_TYPES.validation:
    case PROBLEM_TYPES.badRequest:
    case PROBLEM_TYPES.businessRule:
      return 'errors.validation';
    case PROBLEM_TYPES.unauthorized:
      return 'errors.unauthorized';
    case PROBLEM_TYPES.forbidden:
      return 'errors.forbidden';
    case PROBLEM_TYPES.passwordChangeRequired:
      return 'errors.passwordChangeRequired';
    case PROBLEM_TYPES.notFound:
      return 'errors.notFound';
    case PROBLEM_TYPES.conflict:
      return 'errors.conflict';
    case PROBLEM_TYPES.preconditionFailed:
      return 'errors.preconditionFailed';
    case PROBLEM_TYPES.preconditionRequired:
      return 'errors.preconditionRequired';
    case PROBLEM_TYPES.tooManyRequests:
      return 'errors.tooManyRequests';
    case NETWORK_ERROR_TYPE:
      return 'errors.network';
    default:
      return 'errors.generic';
  }
}

/** Correlation ids are shown for server faults (5xx) so users can quote them; other errors need no reference. */
export function correlationIdFor(error: ApiError): string | undefined {
  return error.status >= 500 ? error.correlationId : undefined;
}

/** Narrows anything thrown by an API call to ApiError (the interceptor maps every HTTP failure to one). */
export function asApiError(e: unknown): ApiError | null {
  return e instanceof ApiError ? e : null;
}
