import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, switchMap, throwError } from 'rxjs';
import { ApiError, toApiError } from '../api/api-error';
import { AuthService } from './auth.service';
import { AuthStore } from './auth.store';

/** Marks a request already retried after a refresh, so a second 401 logs out instead of refreshing again. */
export const RETRIED = new HttpContextToken<boolean>(() => false);

/** Anonymous endpoints: never carry the bearer token, and their 401s never trigger a refresh. */
const NO_BEARER = new Set(['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']);

const isApiUrl = (url: string) => url.startsWith('/api/');
const pathOf = (url: string) => url.split(/[?#]/, 1)[0];

function withBearer(
  req: HttpRequest<unknown>,
  token: string,
  retried = false,
): HttpRequest<unknown> {
  let context = req.context;
  if (retried) {
    // Copy rather than mutate: the caller may share one HttpContext between requests.
    context = new HttpContext();
    for (const key of req.context.keys()) context.set(key, req.context.get(key));
    context.set(RETRIED, true);
  }
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` }, context });
}

/**
 * Same-origin `/api/*` only (absolute URLs and assets are untouched): adds the in-memory bearer token, refreshes once
 * on 401 (single-flight via AuthService.refresh) and retries once, sends the user to /login when the session cannot
 * be recovered and to /change-password on the password-change-required 403, and maps every error to ApiError.
 * Never logs or stores token material.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiUrl(req.url)) return next(req);

  const injector = inject(Injector);
  const store = inject(AuthStore);
  const usesBearer = !NO_BEARER.has(pathOf(req.url));
  const token = usesBearer ? store.getAccessToken() : null;
  const outgoing = token !== null ? withBearer(req, token) : req;

  return next(outgoing).pipe(
    catchError((error: unknown) => handleError(error, outgoing, token, next, injector)),
  );
};

function handleError(
  error: unknown,
  req: HttpRequest<unknown>,
  sentToken: string | null,
  next: HttpHandlerFn,
  injector: Injector,
): Observable<HttpEvent<unknown>> {
  if (!(error instanceof HttpErrorResponse)) return throwError(() => error);

  const apiError = toApiError(error);
  const store = injector.get(AuthStore);

  if (apiError.status === 401 && sentToken !== null) {
    if (req.context.get(RETRIED)) {
      endSession(injector);
      return throwError(() => apiError);
    }
    return recoverFrom401(req, sentToken, next, injector, apiError);
  }

  if (apiError.isPasswordChangeRequired) {
    store.setMustChangePassword(true);
    const router = injector.get(Router);
    if (!router.url.startsWith('/change-password')) void router.navigate(['/change-password']);
  }

  return throwError(() => apiError);
}

function recoverFrom401(
  req: HttpRequest<unknown>,
  sentToken: string,
  next: HttpHandlerFn,
  injector: Injector,
  original: ApiError,
): Observable<HttpEvent<unknown>> {
  const store = injector.get(AuthStore);
  const current = store.getAccessToken();

  // Signed out meanwhile: nothing to recover.
  if (current === null) return throwError(() => original);

  // Sent with a token that has already been replaced (a refresh finished in the meantime): retry, don't refresh.
  const fresh$: Observable<string> =
    current !== sentToken ? of(current) : injector.get(AuthService).refresh();

  return fresh$.pipe(
    catchError(() => {
      endSession(injector);
      return throwError(() => original);
    }),
    switchMap((newToken) => {
      const retry = withBearer(req, newToken, true);
      return next(retry).pipe(
        catchError((error: unknown) => handleError(error, retry, newToken, next, injector)),
      );
    }),
  );
}

/** Clears the session and routes to /login once (concurrent failures share the first redirect). */
function endSession(injector: Injector): void {
  const store = injector.get(AuthStore);
  if (!store.isAuthenticated()) return;
  store.clear();
  const router = injector.get(Router);
  const returnUrl = router.url;
  const queryParams =
    returnUrl && returnUrl !== '/' && !returnUrl.startsWith('/login') ? { returnUrl } : {};
  void router.navigate(['/login'], { queryParams });
}
