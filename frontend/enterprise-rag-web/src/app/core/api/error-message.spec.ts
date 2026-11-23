import { ApiError } from './api-error';
import { correlationIdFor, messageKeyFor } from './error-message';
import { NETWORK_ERROR_TYPE, PROBLEM_TYPES } from './problem-details';

const err = (type: string, status = 400, correlationId = 'cid') =>
  new ApiError({ type, title: 'T', status, correlationId, detail: 'SECRET SERVER DETAIL' });

describe('error-message', () => {
  it('ErrorMessage_MapsProblemTypesToKeys', () => {
    const cases: [string, string][] = [
      [PROBLEM_TYPES.validation, 'errors.validation'],
      [PROBLEM_TYPES.badRequest, 'errors.validation'],
      [PROBLEM_TYPES.unauthorized, 'errors.unauthorized'],
      [PROBLEM_TYPES.forbidden, 'errors.forbidden'],
      [PROBLEM_TYPES.notFound, 'errors.notFound'],
      [PROBLEM_TYPES.conflict, 'errors.conflict'],
      [PROBLEM_TYPES.preconditionFailed, 'errors.preconditionFailed'],
      [PROBLEM_TYPES.preconditionRequired, 'errors.preconditionRequired'],
      [PROBLEM_TYPES.tooManyRequests, 'errors.tooManyRequests'],
      [NETWORK_ERROR_TYPE, 'errors.network'],
      [PROBLEM_TYPES.internalError, 'errors.generic'],
      ['https://example.test/unknown', 'errors.generic'],
    ];
    for (const [type, key] of cases) expect(messageKeyFor(err(type))).toBe(key);
  });

  it('ErrorMessage_KeysOnType_NotStatus', () => {
    expect(messageKeyFor(err(PROBLEM_TYPES.conflict, 500))).toBe('errors.conflict');
  });

  it('ErrorMessage_CorrelationIdOnlyFor5xx', () => {
    expect(correlationIdFor(err(PROBLEM_TYPES.internalError, 500, 'abc'))).toBe('abc');
    expect(correlationIdFor(err(PROBLEM_TYPES.notFound, 404, 'abc'))).toBeUndefined();
  });
});
