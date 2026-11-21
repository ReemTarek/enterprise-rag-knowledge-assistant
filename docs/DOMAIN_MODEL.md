# Domain Model

As implemented at the end of Phase 2a (`src/EnterpriseRag.Domain`, no framework dependencies).

## Base types

- `Entity`: `Id` (GUID v7, generated on construction).
- `AuditableEntity`: `CreatedAt`, `UpdatedAt`, `CreatedBy`, `UpdatedBy` (set by an EF interceptor; `CreatedAt/By` are never modified).
- `SoftDeletableEntity`: `IsDeleted`, `DeletedAt`. `MarkDeleted(utcNow)` requires a UTC `DateTime` and throws `DomainException`
  if already deleted. A global query filter hides deleted rows.
- `DomainException`: a business rule was violated (mapped to HTTP 400, or to 409 where the handler translates it).

## User (`SoftDeletableEntity`)

Fields: `Email`, `DisplayName`, `PasswordHash`, `GlobalRole` (`User` | `Admin`), `IsActive`, `MustChangePassword`,
`FailedLoginCount`, `LockoutEndUtc`.

Invariants:
- Created only via `User.Create(email, displayName, passwordHash, role, mustChangePassword)`: email and display name are
  required; email is trimmed and lower-cased, display name trimmed.
- `RegisterFailedLogin(utcNow, maxAttempts, lockout)`: UTC required; increments the counter; at `maxAttempts` sets
  `LockoutEndUtc = utcNow + lockout` and resets the counter to 0.
- `RegisterSuccessfulLogin()` clears the counter and the lockout. `IsLockedOut(utcNow)` is `LockoutEndUtc > utcNow` (UTC required).
- `Deactivate()` sets `IsActive = false` (there is no reactivation yet). `SetPassword(hash, mustChange)`.
- Only `Admin` is a global role; it grants user administration, never knowledge-base access.

## RefreshToken (`Entity`)

`UserId`, `TokenHash` (SHA-256, base64url; the raw value is never stored), `FamilyId` (one login = one family),
`ExpiresAt`, `RevokedAt`, `ReplacedByTokenHash`. `IsActive(utcNow)` = not revoked and not expired. A shadow rowversion on
the table makes concurrent rotation of one token fail.

## KnowledgeBase (`SoftDeletableEntity`, aggregate root)

Fields: `Name` (1-200 chars after trim), `Description` (optional, max 2000 at the application/DB level), `PermissionVersion`,
`RowVersion`, `Members` (read-only collection of `KnowledgeBaseUser`).

Invariants:
- `Create(name, description, ownerId)`: the creator is the first member with role Owner; `PermissionVersion` starts at 1.
- `AddMember`: a user can be a member only once (`DomainException` otherwise); increments `PermissionVersion`.
- `ChangeMemberRole`: unchanged role is a no-op (no version bump); demoting the last Owner is rejected; bumps `PermissionVersion`.
- `RemoveMember`: removing the last Owner is rejected; bumps `PermissionVersion`.
- A knowledge base always keeps at least one Owner.
- `RoleOf(userId)` returns the member's role or null.

## KnowledgeBaseUser

`(KnowledgeBaseId, UserId)` identifies the membership; `Role` is `KnowledgeBaseRole` ordered Viewer(0) < Editor(1) < Owner(2),
so a higher role includes the rights of lower ones. The authorization rule lives in `IAccessPolicy` (Application).

## AuditLog (`Entity`)

`Action`, `ActorId`, `TargetType`, `TargetId`, `OccurredAt`, `DetailsJson`. Append-only: persistence rejects updates and deletes.

## Application-level exception semantics

| Exception | HTTP | Use |
|---|---|---|
| `ValidationException` (FluentValidation) | 400 | malformed input |
| `DomainException` | 400 | invariant violated and not translated by the handler |
| `AuthenticationFailedException` | 401 | generic credentials failure |
| `AccessDeniedException` | 403 | known caller, insufficient role |
| `NotFoundException` | 404 | missing or not visible |
| `ConflictException` | 409 | duplicate, last owner, state conflict, unique-key violation |
| `ConcurrencyConflictException` (subclass of Conflict) | 412 | stale knowledge-base rowversion |
