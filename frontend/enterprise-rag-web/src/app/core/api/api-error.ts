import { HttpErrorResponse } from '@angular/common/http';
import {
  NETWORK_ERROR_TYPE,
  PROBLEM_TYPES,
  ProblemDetails,
  problemTypeForStatus,
} from './problem-details';

/**
 * The only error type API calls surface. Built from the response's ProblemDetails (or a synthetic one for empty,
 * non-JSON and network failures). Holds no request data: never headers, never the access token.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly correlationId?: string;
  readonly errors?: Record<string, string[]>;
  readonly problem: ProblemDetails;
  readonly isPasswordChangeRequired: boolean;

  constructor(problem: ProblemDetails) {
    super(problem.title || `HTTP ${problem.status}`);
    this.name = 'ApiError';
    this.problem = problem;
    this.status = problem.status;
    this.type = problem.type;
    this.title = problem.title;
    this.correlationId = problem.correlationId;
    this.errors = problem.errors;
    this.isPasswordChangeRequired = problem.type === PROBLEM_TYPES.passwordChangeRequired;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

function validationErrors(v: unknown): Record<string, string[]> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(v)) {
    if (!Array.isArray(messages) || !messages.every((m) => typeof m === 'string')) return undefined;
    out[field] = messages as string[];
  }
  return out;
}

/** Maps any HttpErrorResponse (problem+json, empty body, HTML from a proxy, network failure) to an ApiError. */
export function toApiError(response: HttpErrorResponse): ApiError {
  const headerCorrelationId = str(response.headers?.get('X-Correlation-Id'));

  if (response.status === 0) {
    return new ApiError({
      type: NETWORK_ERROR_TYPE,
      title: 'Network error',
      status: 0,
      correlationId: headerCorrelationId,
    });
  }

  const body = isRecord(response.error) ? response.error : {};
  return new ApiError({
    type: str(body['type']) ?? problemTypeForStatus(response.status),
    title: str(body['title']) ?? str(response.statusText) ?? `HTTP ${response.status}`,
    status: response.status,
    detail: str(body['detail']),
    correlationId: str(body['correlationId']) ?? headerCorrelationId,
    errors: validationErrors(body['errors']),
  });
}
