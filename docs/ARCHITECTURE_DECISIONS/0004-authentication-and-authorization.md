# 0004 Authentication and authorization

Status: accepted (Phase 2a)

## Context
Phase 2 needs sign-in, admin-managed users and per-knowledge-base access control (spec section 11c). The design spec
(section 8) named "full ASP.NET Core Identity". The Onion rules require the Domain to have no framework or provider
dependencies, and the product needs no email confirmation, external login or self-registration.

## Decision
- **Domain-owned `User` plus Identity's `PasswordHasher<T>` only.** `User` is a plain domain entity. Only the password
  hashing algorithm of `Microsoft.AspNetCore.Identity` is used, in Infrastructure behind `IPasswordHasher`. This
  deviates from "full ASP.NET Core Identity" because Identity's `IdentityUser`/stores would put framework types into the
  Domain (violating the architecture tests) and bring features (email, external logins, UI) we do not use.
- **JWT access token + rotating refresh cookie.** HS256 access token, 15 minutes. Opaque 7-day refresh token stored
  hashed, delivered only as an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie, rotated on every use with
  family revocation on reuse. Logout is anonymous (the cookie is the credential) so an expired access token cannot
  trap a session.
- **Role claim verified against SQL on every request.** A token is valid only while the user is active, not deleted
  and still has the role in the token. Deactivation and demotion are immediate; authorization does not rest on a stale claim.
- **404 for non-members.** Knowledge-base access goes through `IAccessPolicy`; missing, deleted and non-member are
  indistinguishable (404). Members below the needed role get 403.
- **Admin has no implicit knowledge-base access.** The global Admin role administers users only.
- **Request-shape errors (400/428) are evaluated before resource resolution.**
- **Account protection numbers:** lockout after 5 failed logins for 15 minutes; rate limits per IP: login 10/min,
  refresh and logout 30/min; password minimum 12 characters with upper, lower and digit; temporary passwords >= 20
  characters, shown once.
- **Password change lives at `POST /api/auth/password`** so the browser sends the `Path=/api/auth` refresh cookie; the
  current device stays signed in, all other sessions are revoked.
- **Must-change-password is enforced by the server, deny-by-default** (added after the Phase 2a final review).
  `MustChangePassword` comes from the same per-request SQL projection as the role check and is put on the principal as
  a server-added claim (`must_change_password`, issuer `enterprise-rag:server`); a same-named token claim is stripped,
  so the token never decides. A `PasswordChangeRequiredRequirement` is added to the default, fallback and `AdminOnly`
  policies — the fallback policy alone would miss endpoints that carry their own `[Authorize]` metadata. Endpoints opt
  out only with `[AllowWhilePasswordChangeRequired]`, used on exactly `POST /api/auth/password` and `GET /api/me`;
  anonymous endpoints never evaluate policies, so login/refresh/logout stay reachable. A custom
  `IAuthorizationMiddlewareResultHandler` writes the denial as 403 ProblemDetails with
  `type .../problems/password-change-required`, distinct from an ordinary 403. Because the flag is re-read per
  request, the same access token works right after the change, and an admin reset blocks existing tokens at once.
  Considered alternative: a middleware after `UseAuthorization` that skips `IAllowAnonymous` endpoints; rejected in
  favour of the policy requirement, which stays inside ASP.NET Core authorization (one result handler, testable via
  `IAuthorizationPolicyProvider`) — a test walks every endpoint so a future policy without the requirement fails.
- **Concurrency:** knowledge bases use a rowversion ETag; `If-Match` is required for updates (428 missing, 412
  stale). The supplied version is compared with the loaded row before saving, so a stale precondition fails even when
  nothing would be updated. Only a failed client precondition is 412; a lost race on an endpoint without `If-Match`
  (membership changes) is 409. Last-owner violations are 409. `ConcurrencyConflictException` (412) is a subclass of
  `ConflictException` (409).
- **Error contract:** every ProblemDetails carries a stable `type` URI (`https://enterprise-rag.local/problems/<kind>`),
  `title`, `status`, `traceId` and `correlationId`.

## Consequences
- Domain and Application stay free of Identity/EF/ASP.NET types (enforced by architecture tests).
- We own lockout, token rotation and reuse detection (tested), instead of inheriting Identity's.
- One indexed SQL lookup per authenticated request (role, active, deleted and must-change in one projection); caching
  is a later optimisation and must not cache the must-change flag beyond the request.
- Any new authorization policy must include `PasswordChangeRequiredRequirement`.
- No email-based flows: password recovery is admin reset. Adding email/external login later means extending the
  domain, not adopting Identity wholesale.
- Rate limiting by IP is only correct behind a trusted proxy configuration (Phase 11).
- Known deferred items are listed in `docs/SECURITY.md` and `docs/PROJECT_PROGRESS.md`.
