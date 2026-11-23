import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

type ParamValue = string | number | boolean;

export interface ApiRequestOptions {
  params?: Record<string, ParamValue | readonly ParamValue[]>;
  /** Sent as `If-Match` (optimistic concurrency, e.g. knowledge-base rowversion). */
  ifMatch?: string;
}

/**
 * Thin typed wrapper over HttpClient for `/api/*`. Errors arrive as `ApiError` (mapped by the auth interceptor).
 * Credentials (the refresh cookie, `Path=/api/auth`) are requested explicitly only for `/api/auth/*`.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);

  get<T>(url: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.get<T>(url, this.options(url, options));
  }

  post<T>(url: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.post<T>(url, body, this.options(url, options));
  }

  put<T>(url: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.put<T>(url, body, this.options(url, options));
  }

  patch<T>(url: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.patch<T>(url, body, this.options(url, options));
  }

  delete<T = void>(url: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.delete<T>(url, this.options(url, options));
  }

  private options(url: string, options?: ApiRequestOptions) {
    let headers = new HttpHeaders();
    if (options?.ifMatch !== undefined) headers = headers.set('If-Match', options.ifMatch);
    return {
      headers,
      params: options?.params ? new HttpParams({ fromObject: options.params }) : undefined,
      withCredentials: url.startsWith('/api/auth/'),
    };
  }
}
