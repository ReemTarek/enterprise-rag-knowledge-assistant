# API Design

All JSON, camelCase, enums as strings (`"Admin"`, `"Viewer"`). All routes except those marked *anonymous* require
`Authorization: Bearer <accessToken>`; missing/invalid/stale tokens get 401.

## Error format

RFC 7807 `application/problem+json`. Every error body contains `correlationId` (also returned in the
`X-Correlation-Id` response header; a client-supplied value is accepted if it is short and has no newlines).

```json
{ "status": 404, "title": "Not found", "detail": "Knowledge base not found.", "correlationId": "..." }
```

| Status | Meaning |
|---|---|
| 400 | Validation failure (`errors` map of field to messages), malformed JSON, malformed `If-Match`, business-rule violation |
| 401 | Missing/invalid/expired token, wrong credentials (always the generic "Invalid credentials.") |
| 403 | Authenticated but not allowed (non-admin on admin route, member below the required KB role) |
| 404 | Not found **or not visible** (non-member, soft-deleted KB: identical body) |
| 409 | Conflict: duplicate email, already a member, last owner, self-deactivation |
| 412 | `If-Match` does not match the knowledge base's current rowversion (or it changed concurrently) |
| 428 | `If-Match` required but absent |
| 429 | Rate limit exceeded (`Retry-After` seconds) |
| 499 | Client closed the request |
| 500 | Unexpected; generic detail outside Development |

Request-shape errors (400, 428) are evaluated before the resource is resolved.

## Paging

`?page=1&pageSize=20` (page >= 1, pageSize defaults to 20 when < 1, capped at 100).
Response: `{ "items": [...], "page": 1, "pageSize": 20, "totalCount": 3 }`.

## Auth (`/api/auth`)

| Method and route | Auth | Request | Response |
|---|---|---|---|
| `POST /api/auth/login` | anonymous, 10/min/IP | `{ email, password }` | 200 `{ accessToken, expiresAtUtc, mustChangePassword }` + `Set-Cookie: refresh_token` ; 401 generic; 429 |
| `POST /api/auth/refresh` | anonymous, 30/min/IP | no body; cookie `refresh_token` | 200 as login with a rotated cookie; 401 (missing/unknown/expired/reused); 429 |
| `POST /api/auth/logout` | anonymous, 30/min/IP | no body; cookie | 204 always; cookie cleared |
| `POST /api/auth/password` | Bearer | `{ currentPassword, newPassword }` (+ refresh cookie to keep the current session) | 204; 400 policy / wrong current password |

Cookie: `refresh_token`, `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`, expires with the token (7 days).

## Current user

| Method and route | Auth | Response |
|---|---|---|
| `GET /api/me` | Bearer | 200 `{ id, email, displayName, globalRole, mustChangePassword }` |

## User directory

| Method and route | Auth | Response |
|---|---|---|
| `GET /api/users/directory?query=` | Bearer | 200 `[{ id, displayName, email }]`, active users only, max 20, ordered by name. `query` 2-100 chars (trimmed) else 400. Matches email or display name (case-insensitive substring). |

## Admin users (`/api/admin/users`, role Admin; non-admin 403)

| Method and route | Request | Response |
|---|---|---|
| `POST /api/admin/users` | `{ email, displayName, globalRole }` (`User`/`Admin`; email max 256, name max 200) | 201 `{ id, email, temporaryPassword }`, `Cache-Control: no-store`; 400; 409 duplicate email |
| `GET /api/admin/users?page&pageSize` | - | 200 paged `{ id, email, displayName, globalRole, isActive, mustChangePassword, lockoutEndUtc }` ordered by email |
| `POST /api/admin/users/{id}/deactivate` | - | 204; revokes all sessions; 404 unknown user; 409 deactivating yourself |
| `POST /api/admin/users/{id}/reset-password` | - | 200 `{ temporaryPassword }`, `Cache-Control: no-store`; sets mustChangePassword, lifts lockout, revokes sessions; 404 |

## Knowledge bases (`/api/knowledge-bases`)

`KnowledgeBaseDto`: `{ id, name, description, myRole, createdAt, updatedAt, rowVersion }`. Name 1-200 chars, description
max 2000. Single-KB responses (create, get, update) carry `ETag: "<rowVersion>"` (strong, quoted base64). Membership changes also touch the knowledge-base row, so they change its ETag.

| Method and route | Min role | Request | Response |
|---|---|---|---|
| `POST /api/knowledge-bases` | any user | `{ name, description? }` | 201 + `Location` + `ETag`, caller becomes Owner; 400 |
| `GET /api/knowledge-bases?page&pageSize` | - | - | 200 paged; only KBs the caller is a member of (admins included), ordered by name |
| `GET /api/knowledge-bases/{id}` | Viewer | - | 200 + `ETag`; 404 |
| `PUT /api/knowledge-bases/{id}` | Owner | `{ name, description? }` + header `If-Match: "<rowVersion>"` | 200 + new `ETag`; 428 no If-Match; 400 invalid If-Match (`*`, weak, list, non-base64) or body; 403; 404; 412 stale |
| `DELETE /api/knowledge-bases/{id}` | Owner | - | 204, soft delete (immediately 404 for everyone); 403; 404 |

## Members (`/api/knowledge-bases/{knowledgeBaseId}/members`)

`KnowledgeBaseMemberDto`: `{ userId, displayName, email, role }`; roles `Viewer`, `Editor`, `Owner`.
The caller's role on the KB in the route is checked first (404 non-member, 403 below the required role), then the target user.

| Method and route | Min role | Request | Response |
|---|---|---|---|
| `GET .../members` | Viewer | - | 200 list, ordered by role (Owner first) then name |
| `POST .../members` | Owner | `{ userId, role }` (role required) | 201 member; 400; 404 unknown/inactive user; 409 already a member |
| `PUT .../members/{userId}` | Owner | `{ role }` (required) | 200 member; same role = no-op 200; 404 not a member; 409 demoting the last owner |
| `DELETE .../members/{userId}` | Owner | - | 204; 404 not a member; 409 removing the last owner |

## Operational

| Route | Auth | Response |
|---|---|---|
| `GET /health/live` | anonymous | 200 process is up |
| `GET /health/ready` | anonymous | 200 database reachable, 503 otherwise (names and status only) |
| `GET /` | anonymous | plain text banner |

Swagger UI is enabled in Development only.
