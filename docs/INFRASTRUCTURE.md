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
