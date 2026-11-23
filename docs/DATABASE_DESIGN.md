# Database Design

SQL Server 2022, EF Core (code first). Context: `AppDbContext`; configurations in
`src/EnterpriseRag.Infrastructure/Persistence/Configurations`. All `DateTime` values are stored and read as UTC
(value converter). Enums are stored as strings.

## Tables

### Users
`Id` (PK, GUID v7), `Email` (nvarchar 256), `DisplayName` (200), `PasswordHash` (512), `GlobalRole` (nvarchar 32:
`User`/`Admin`), `IsActive`, `MustChangePassword`, `FailedLoginCount`, `LockoutEndUtc`, `IsDeleted`, `DeletedAt`,
`CreatedAt`, `UpdatedAt`, `CreatedBy`, `UpdatedBy` (200).
- Index `IX_Users_Email`: **unique, filtered `WHERE [IsDeleted] = 0`** - an email is unique among live accounts and can be
  reused after a soft delete. Emails are stored lower-case.

### KnowledgeBases
`Id` (PK), `Name` (200), `Description` (2000, null), `PermissionVersion` (int), `RowVersion` (`rowversion`, concurrency
token and ETag source), soft-delete and audit columns as above.

### KnowledgeBaseUsers
Composite PK `(KnowledgeBaseId, UserId)` (the unique one-membership-per-user constraint), `Role` (nvarchar 32:
`Viewer`/`Editor`/`Owner`).
- Index `IX_KnowledgeBaseUsers_UserId_KnowledgeBaseId` for "which KBs can this user see".
- FK to KnowledgeBases: **cascade**. FK to Users: **restrict** (users are soft-deleted, never hard-deleted).

### RefreshTokens
`Id` (PK), `UserId`, `TokenHash` (128), `FamilyId`, `ExpiresAt`, `RevokedAt` (null), `ReplacedByTokenHash` (128, null),
`RowVersion` (shadow `rowversion`: two requests rotating the same token cannot both succeed).
- Index `IX_RefreshTokens_TokenHash` (unique); index `IX_RefreshTokens_UserId_FamilyId`.
- FK to Users: **cascade**.

### AuditLogs
`Id` (PK), `Action` (200), `ActorId` (200, null), `TargetType` (200), `TargetId` (200), `OccurredAt`, `DetailsJson`
(nvarchar(max), null). Index on `OccurredAt`. Append-only via an EF interceptor (bulk SQL bypasses it; DB-level
enforcement planned for Phase 10).

## Global behaviours
- Soft-delete query filter on every `SoftDeletableEntity` (Users, KnowledgeBases).
- `AuditableEntityInterceptor` fills `CreatedAt/By`, `UpdatedAt/By` from the clock and the current user.
- `SaveChangesAsync` maps `DbUpdateConcurrencyException` to `ConcurrencyConflictException` (knowledge bases, 412) or
  `ConflictException` (other, 409), unique-key violations (SQL 2601/2627) to `ConflictException`, and clears the change
  tracker on either.

## Migrations
1. `20261118172517_InitialCreate` - AuditLogs.
2. `20261118191226_AddIdentityAndKnowledgeBases` - Users, KnowledgeBases, KnowledgeBaseUsers, RefreshTokens and indexes.

Apply with the command in `docs/INFRASTRUCTURE.md`. The API never migrates automatically; the admin seed only runs when the
schema is current (it skips with a warning if the database is unreachable or has pending migrations).
