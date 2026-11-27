import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ApiError, toApiError } from './api-error';
import { messageKeyFor } from './error-message';
import { NETWORK_ERROR_TYPE, PROBLEM_TYPES, problemTypeForStatus } from './problem-details';

describe('ApiError / problem types', () => {
  it('ProblemTypes_MatchServerUris', () => {
    // Hand-copied from src/EnterpriseRag.API/Http/ProblemTypes.cs (and docs/API_DESIGN.md "Error format"): pins the
    // values the client relies on. Drift against the real server file is caught by scripts/problem-types-sync.test.mjs
    // (npm run test:guard, part of npm run lint), which reads ProblemTypes.cs itself.
    const serverUris = [
      'https://enterprise-rag.local/problems/validation',
      'https://enterprise-rag.local/problems/bad-request',
      'https://enterprise-rag.local/problems/business-rule',
      'https://enterprise-rag.local/problems/unauthorized',
      'https://enterprise-rag.local/problems/forbidden',
      'https://enterprise-rag.local/problems/password-change-required',
      'https://enterprise-rag.local/problems/not-found',
      'https://enterprise-rag.local/problems/conflict',
      'https://enterprise-rag.local/problems/precondition-failed',
      'https://enterprise-rag.local/problems/precondition-required',
      'https://enterprise-rag.local/problems/too-many-requests',
      'https://enterprise-rag.local/problems/internal-error',
    ];
    expect(Object.values(PROBLEM_TYPES).sort()).toEqual([...serverUris].sort());
    expect(PROBLEM_TYPES.passwordChangeRequired).toBe(
      'https://enterprise-rag.local/problems/password-change-required',
    );
  });

  it('ProblemTypeForStatus_MirrorsServerFallback', () => {
    expect(problemTypeForStatus(401)).toBe(PROBLEM_TYPES.unauthorized);
    expect(problemTypeForStatus(404)).toBe(PROBLEM_TYPES.notFound);
    expect(problemTypeForStatus(500)).toBe(PROBLEM_TYPES.internalError);
    expect(problemTypeForStatus(499)).toBe('https://enterprise-rag.local/problems/http-499');
  });

  it('ToApiError_MapsProblemDetailsBody', () => {
    const err = toApiError(
      new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        url: '/api/knowledge-bases',
        headers: new HttpHeaders({ 'X-Correlation-Id': 'header-cid' }),
        error: {
          type: PROBLEM_TYPES.validation,
          title: 'One or more validation errors occurred.',
          status: 400,
          detail: 'See errors.',
          correlationId: 'body-cid',
          errors: { name: ['Name is required.'] },
        },
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.type).toBe(PROBLEM_TYPES.validation);
    expect(err.title).toBe('One or more validation errors occurred.');
    expect(err.correlationId).toBe('body-cid');
    expect(err.errors).toEqual({ name: ['Name is required.'] });
    expect(err.problem.detail).toBe('See errors.');
    expect(err.isPasswordChangeRequired).toBe(false);
  });

  it('ToApiError_EmptyOrNonJsonBody_FallsBackToStatusAndHeader', () => {
    const empty = toApiError(
      new HttpErrorResponse({
        status: 499,
        headers: new HttpHeaders({ 'X-Correlation-Id': 'cid-499' }),
        error: null,
      }),
    );
    expect(empty.status).toBe(499);
    expect(empty.type).toBe('https://enterprise-rag.local/problems/http-499');
    expect(empty.correlationId).toBe('cid-499');
    expect(empty.errors).toBeUndefined();

    const html = toApiError(
      new HttpErrorResponse({
        status: 500,
        statusText: 'Internal Server Error',
        error: '<html>proxy</html>',
      }),
    );
    expect(html.status).toBe(500);
    expect(html.type).toBe(PROBLEM_TYPES.internalError);
    expect(html.problem.detail).toBeUndefined();

    const badShape = toApiError(
      new HttpErrorResponse({ status: 400, error: { type: 42, errors: { a: 'not-an-array' } } }),
    );
    expect(badShape.type).toBe(PROBLEM_TYPES.badRequest);
    expect(badShape.errors).toBeUndefined();
  });

  it('ToApiError_NetworkFailure_IsStatusZeroNetworkType', () => {
    const err = toApiError(
      new HttpErrorResponse({ status: 0, error: new ProgressEvent('error'), url: '/api/me' }),
    );
    expect(err.status).toBe(0);
    expect(err.type).toBe(NETWORK_ERROR_TYPE);
    expect(NETWORK_ERROR_TYPE).toBe('network');
  });

  it('ToApiError_PasswordChangeRequired_IsFlagged', () => {
    const err = toApiError(
      new HttpErrorResponse({
        status: 403,
        error: {
          type: PROBLEM_TYPES.passwordChangeRequired,
          title: 'Password change required',
          status: 403,
        },
      }),
    );
    expect(err.isPasswordChangeRequired).toBe(true);
  });

  // D8: a reverse/dev proxy answers 502/503/504 itself (HTML, text or empty body) when the API is down. That is
  // "cannot reach the server" for the user, not a server fault, so it maps to the network kind (status kept).
  for (const status of [502, 503, 504]) {
    for (const [label, body] of [
      ['html', '<html><body>Bad Gateway</body></html>'],
      ['empty', null],
      ['json without type/title', { message: 'upstream down' }],
    ] as [string, unknown][]) {
      it(`ApiError_${status}WithoutProblem_MapsToNetwork (${label})`, () => {
        const err = toApiError(
          new HttpErrorResponse({ status, statusText: 'Proxy', error: body, url: '/api/me' }),
        );
        expect(err.status).toBe(status);
        expect(err.type).toBe(NETWORK_ERROR_TYPE);
        expect(messageKeyFor(err)).toBe('errors.network');
      });
    }
  }

  it('ApiError_503WithProblemDetails_KeepsItsType', () => {
    const type = 'https://enterprise-rag.local/problems/http-503';
    const err = toApiError(
      new HttpErrorResponse({
        status: 503,
        error: { type, title: 'Service Unavailable', status: 503, correlationId: 'cid-503' },
      }),
    );
    expect(err.status).toBe(503);
    expect(err.type).toBe(type);
    expect(err.correlationId).toBe('cid-503');
    expect(messageKeyFor(err)).toBe('errors.generic');

    const titleOnly = toApiError(
      new HttpErrorResponse({ status: 502, error: { title: 'Bad Gateway', status: 502 } }),
    );
    expect(titleOnly.type).toBe('https://enterprise-rag.local/problems/http-502');
  });

  it('ApiError_500WithoutProblem_StaysServerFault', () => {
    const err = toApiError(new HttpErrorResponse({ status: 500, error: null }));
    expect(err.type).toBe(PROBLEM_TYPES.internalError);
  });
});
