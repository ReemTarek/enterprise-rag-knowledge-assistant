# Infrastructure

## Local environment (Docker Compose)

Compose currently runs a single service, `sqlserver` (SQL Server 2022, pinned tag
`2022-CU14-ubuntu-22.04`). No other services belong in Compose yet.

Setup:

```bash
cp .env.example .env        # then edit MSSQL_SA_PASSWORD (strong password required)
docker compose up -d sqlserver
docker compose ps           # wait for STATUS "healthy"
```

`.env` is git-ignored; only `.env.example` (placeholder value) is committed.

- Port: `127.0.0.1:1433` only (loopback; not exposed to the network).
- Volume: named volume `sqlserver-data` mounted at `/var/opt/mssql`. `docker compose down`
  keeps it; `docker compose down -v` deletes the data.
- Healthcheck: `sqlcmd` (`/opt/mssql-tools18`, `-C` trusts the dev certificate) runs `SELECT 1`.

### Connection string

The API and the EF design-time factory read `Database:ConnectionString`
(env var `Database__ConnectionString`). Use user-secrets for the API (the API project has a `UserSecretsId`):

```bash
dotnet user-secrets set "Database:ConnectionString" "Server=127.0.0.1,1433;Database=EnterpriseRag;User Id=sa;Password=<your .env password>;TrustServerCertificate=True" --project src/EnterpriseRag.API
```

Apply migrations:

```bash
export Database__ConnectionString="Server=127.0.0.1,1433;Database=EnterpriseRag;User Id=sa;Password=<pw>;TrustServerCertificate=True"
dotnet ef database update --configuration Release --startup-project src/EnterpriseRag.Infrastructure --project src/EnterpriseRag.Infrastructure
```

### Application configuration (Phase 2a)

All keys can be set as environment variables (double underscore for `:`), user-secrets (API project) or appsettings.
Secrets must never be committed.

| Key / env var | Required | Default | Notes |
|---|---|---|---|
| `Database__ConnectionString` | yes | - | see above |
| `Jwt__Issuer`, `Jwt__Audience` | yes | `EnterpriseRag` (appsettings.json) | must match for issuing and validating |
| `Jwt__SigningKey` | yes | none (startup fails) | HMAC-SHA256 secret, at least 32 UTF-8 bytes |
| `Jwt__AccessTokenMinutes` | no | 15 | 1-1440 |
| `Jwt__RefreshTokenDays` | no | 7 | 1-365 |
| `Seed__AdminEmail`, `Seed__AdminPassword` | only while the DB has no users | - | password `Security__MinPasswordLength` to 128 chars; the seeded admin must change it at first sign-in (enforced: every other endpoint answers 403 password-change-required until then). Startup fails if the database is reachable, has a Users table (even with a later migration pending) with no live users, and these are missing or invalid. A missing Users table (SQL error 207/208) or an unreachable database only logs a warning. |
| `Security__MaxFailedLogins` | no | 5 | lockout threshold (1-100) |
| `Security__LockoutMinutes` | no | 15 | 1-1440 |
| `Security__MinPasswordLength` | no | 12 | 8-128 |

Generate a signing key (cryptographically random, works on Windows PowerShell 5.1 and later):

```powershell
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

or, where OpenSSL is available: `openssl rand -base64 48`.

User-secrets for local development (stored outside the repo):

```bash
dotnet user-secrets set "Jwt:SigningKey" "<generated key>" --project src/EnterpriseRag.API
dotnet user-secrets set "Seed:AdminEmail" "admin@example.test" --project src/EnterpriseRag.API
dotnet user-secrets set "Seed:AdminPassword" "<strong password>" --project src/EnterpriseRag.API
```

### Quick start (local run)

1. `cp .env.example .env`, set a strong `MSSQL_SA_PASSWORD`, then `docker compose up -d sqlserver` and wait for `healthy`.
2. Set `Database:ConnectionString` (user-secrets or env var, above) and apply migrations with the `dotnet ef` command above.
3. Set `Jwt__SigningKey`, `Seed__AdminEmail`, `Seed__AdminPassword` (user-secrets or env vars).
4. `dotnet run --project src/EnterpriseRag.API -c Release` (or `--launch-profile` in Development for Swagger). On the first start with an empty,
   migrated database the admin is seeded. If the Users table does not exist yet or the database is unreachable, the seed is skipped
   with a warning. Sign in as the seeded admin and call `POST /api/auth/password` first: until then every other
   authenticated endpoint except `GET /api/me` returns 403 `password-change-required`.
5. `curl -X POST http://localhost:<port>/api/auth/login -H "Content-Type: application/json" -d '{"email":"...","password":"..."}'`.
   The refresh cookie is `Secure`, so plain-http clients such as curl do not resend it automatically.

### Browser clients: HTTPS and CORS

- The refresh cookie is `Secure; SameSite=Strict; Path=/api/auth`. Browsers store and send `Secure` cookies only over
  HTTPS, with `http://localhost` as the usual exception, so serve the API over HTTPS (or localhost) for browser sign-in
  to keep a session.
- **No CORS is configured.** A browser app on another origin cannot call the API (and cross-site requests would not
  carry the SameSite=Strict cookie anyway). For Phase 2b the Angular dev server must proxy `/api` to the API so both
  share one origin (`proxy.conf.json`), or CORS with credentials for an explicit origin list must be added
  deliberately (and the cookie's SameSite reviewed).

Teardown: `docker compose down -v` (deletes data).

### Ollama

Ollama runs natively on Windows, outside Compose (unchanged). The API on the host uses
`http://localhost:11434`. A container that needs host Ollama must use
`http://host.docker.internal:11434`.

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every push and pull request with `contents: read`
permissions: checkout, `setup-dotnet` (SDK from `global.json`), restore,
`dotnet build -c Release --no-restore`, `dotnet test -c Release --no-build` (all test projects,
including architecture tests; Testcontainers uses the runner's Docker). No secrets are used.
No frontend job until Phase 2.

## Later

The API Docker image and its Compose service arrive in Phase 11.
