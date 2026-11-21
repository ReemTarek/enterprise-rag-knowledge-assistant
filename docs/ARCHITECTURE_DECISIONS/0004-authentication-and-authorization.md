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
- **Concurrency:** knowledge bases use a rowversion ETag; `If-Match` is required for updates (428 missing, 412
  stale). Last-owner violations are 409. `ConcurrencyConflictException` (412) is a subclass of `ConflictException` (409).

## Consequences
- Domain and Application stay free of Identity/EF/ASP.NET types (enforced by architecture tests).
- We own lockout, token rotation and reuse detection (tested), instead of inheriting Identity's.
- One indexed SQL lookup per authenticated request; caching is a later optimisation.
- No email-based flows: password recovery is admin reset. Adding email/external login later means extending the
  domain, not adopting Identity wholesale.
- Rate limiting by IP is only correct behind a trusted proxy configuration (Phase 11).
- Known deferred items are listed in `docs/SECURITY.md` and `docs/PROJECT_PROGRESS.md`.
