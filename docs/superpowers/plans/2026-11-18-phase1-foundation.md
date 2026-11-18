# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A building, tested, runnable skeleton of the Onion-architecture backend (API + Worker hosts), with logging, error handling, health checks, SQL Server/EF Core and an initial migration, architecture tests, a local SQL Server in Docker Compose, basic CI, and the project documentation scaffold.

**Architecture:** Modular monolith per the spec: `Domain ← Application ← Infrastructure ← API/Worker`, `Shared` for contracts/options. Architecture tests are written first and enforce the dependency rules for every later phase. No feature logic yet (no auth, KBs, documents, AI).

**Tech Stack:** .NET SDK 11.0.100 (installed; fallback to .NET 10 LTS pre-approved), ASP.NET Core, EF Core + SQL Server, Serilog, Swagger/OpenAPI, xUnit, NetArchTest, Testcontainers (SQL Server), Docker Compose, GitHub Actions. All package versions verified against official docs/NuGet and .NET 11 compatibility when added; incompatible package → log an ADR and use the pre-approved fallback.

**Spec:** `docs/superpowers/specs/2026-11-18-enterprise-rag-design.md`

## Global Constraints
- Project names: `EnterpriseRag.{Domain,Application,Infrastructure,API,Worker,Shared}` under `src/`; tests `EnterpriseRag.{Domain,Application,Infrastructure}.Tests`, `EnterpriseRag.API.IntegrationTests`, `EnterpriseRag.Architecture.Tests` under `tests/`.
- Domain and Application reference no provider packages (EF Core, ASP.NET Core, Ollama, Qdrant, AWS, Redis, RabbitMQ, Hangfire).
- No MediatR. Plain handler classes.
- All timestamps UTC via `IDateTimeProvider`; never `DateTime.UtcNow` in Domain/Application.
- No secrets in git; `.env` is git-ignored; only `.env.example` is committed.
- Central package management (`Directory.Packages.props`), `global.json` pins the SDK, `Nullable` and `TreatWarningsAsErrors` enabled.
- Do not create cloud resources; Compose binds ports to `127.0.0.1`.
- Commit after each task; commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Git identity (`user.name`/`user.email`) must be configured by the user before the first commit.

## Review Focus
1. SQL Server down → `/health/ready` unhealthy (503) while `/health/live` stays healthy (Task 8 test).
2. Missing or invalid configuration (empty connection string, bad option values) fails fast at startup with a clear message, not at first request (Task 5 test).
3. Unhandled exceptions return RFC 7807 ProblemDetails with no stack trace or inner message outside Development (Task 7 test).
4. Hostile `X-Correlation-ID` header (oversized, control characters/newlines) is replaced, not echoed into logs/response (Task 7 test).
5. Soft-deleted rows never returned by default queries; audit timestamps come from `IDateTimeProvider` (Task 6 tests).

---

### Task 1: Toolchain verification, git baseline, docs scaffold
**Files:**
- Create: `global.json`, `docs/PROJECT_PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `docs/ARCHITECTURE_DECISIONS/0001-onion-architecture.md`, `0002-ollama-provider.md`, `0003-dotnet11-node26-toolchain.md`
- Modify: none

**Interfaces:** Produces: `docs/PROJECT_PROGRESS.md` (sections: Current phase, Completed milestones, Status, Decisions, Important file locations, Pending work, Known issues, Failing tests/outstanding validation, Next task) — updated by every later task.

- [ ] **Step 1:** Confirm user has set git identity: `git config user.name && git config user.email` — Expected: both non-empty; if not, stop and ask the user.
- [ ] **Step 2:** Verify Angular CLI support for Node 26 from official Angular docs (version compatibility table); record result in ADR 0003 (no scaffolding of Angular in this phase). If unsupported, record the Node LTS fallback and tell the user.
- [ ] **Step 3:** Create `global.json` pinning `11.0.100` with `rollForward: latestFeature`; run `dotnet --version` in repo root — Expected: `11.0.100`.
- [ ] **Step 4:** Write the three ADRs (context, decision, consequences) and `PROJECT_PROGRESS.md` (phase = Phase 1 in progress; link spec and this plan) and stub `ARCHITECTURE.md` (diagram from spec §5) and `IMPLEMENTATION_ROADMAP.md` (phases from spec §10).
- [ ] **Step 5:** Commit initial staged files plus these: `git add -A && git commit -m "chore: baseline, skills, spec, plan, docs scaffold"`.

### Task 2: Solution skeleton and build rules
**Files:**
- Create: `EnterpriseRag.sln`, `Directory.Build.props`, `Directory.Packages.props`, the six `src/*` and five `tests/*` projects, `src/EnterpriseRag.Worker/Program.cs` (host with Serilog only for now)
- Test: `tests/EnterpriseRag.Architecture.Tests` (empty until Task 3)

**Interfaces:** Produces project references exactly: Application→Domain,Shared; Infrastructure→Application,Domain,Shared; API→Application,Infrastructure,Shared; Worker→Application,Infrastructure,Shared; Domain→(none); Shared→(none).

- [ ] **Step 1:** Create projects with `dotnet new` (classlib/webapi/worker/xunit) and add to the solution; add the references listed above; enable central package management and `TreatWarningsAsErrors`.
- [ ] **Step 2:** `dotnet build EnterpriseRag.sln` — Expected: Build succeeded, 0 warnings.
- [ ] **Step 3:** Commit `chore: solution skeleton`.

### Task 3: Architecture tests (written first)
**Files:**
- Create: `tests/EnterpriseRag.Architecture.Tests/DependencyRulesTests.cs`
- Modify: `Directory.Packages.props` (add NetArchTest.Rules after verifying .NET 11 compatibility)

**Interfaces:** Produces tests that later phases must keep green.

- [ ] **Step 1:** Write tests: `Domain_DoesNotDependOn_ApplicationInfrastructureApiWorker`; `Domain_DoesNotReference_ProviderNamespaces` (Microsoft.EntityFrameworkCore, Microsoft.AspNetCore, Hangfire, StackExchange.Redis, RabbitMQ, MassTransit, Amazon, Qdrant, OllamaSharp); `Application_DoesNotDependOn_InfrastructureApiWorker` and same provider list; `Infrastructure_DoesNotDependOn_ApiWorker`; `Controllers_DoNotDependOn_InfrastructureNamespaces` (controllers may use only Application/Shared types).
- [ ] **Step 2:** `dotnet test tests/EnterpriseRag.Architecture.Tests` — Expected: PASS on the empty skeleton (a project with no types under test must not vacuously pass: add an assertion that each assembly loads and contains at least one type, add a marker class per project to satisfy it).
- [ ] **Step 3:** Prove it bites: temporarily add a forbidden reference (e.g. Domain referencing `Microsoft.EntityFrameworkCore`), run tests — Expected: FAIL; revert.
- [ ] **Step 4:** Commit `test: architecture dependency rules`.

### Task 4: Domain base types and time abstraction
**Files:**
- Create: `src/EnterpriseRag.Domain/Common/{Entity.cs,AuditableEntity.cs,SoftDeletableEntity.cs,DomainException.cs}`, `src/EnterpriseRag.Application/Abstractions/{IDateTimeProvider.cs,ICurrentUserService.cs}`, `tests/EnterpriseRag.Domain.Tests/Common/AuditableEntityTests.cs`

**Interfaces:**
- Produces: `abstract class Entity { Guid Id; }`; `abstract class AuditableEntity : Entity { DateTime CreatedAt; DateTime? UpdatedAt; string? CreatedBy; string? UpdatedBy; }`; `abstract class SoftDeletableEntity : AuditableEntity { bool IsDeleted; DateTime? DeletedAt; void MarkDeleted(DateTime utcNow); }`; `class DomainException(string message) : Exception`; `interface IDateTimeProvider { DateTime UtcNow { get; } }`; `interface ICurrentUserService { string? UserId { get; } }`.

- [ ] **Step 1:** Write failing tests: `MarkDeleted_SetsIsDeletedAndDeletedAt`; `MarkDeleted_Twice_ThrowsDomainException`; `MarkDeleted_WithNonUtcKind_ThrowsDomainException`.
- [ ] **Step 2:** `dotnet test tests/EnterpriseRag.Domain.Tests` — Expected: FAIL (types missing).
- [ ] **Step 3:** Implement the types above.
- [ ] **Step 4:** Run domain + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(domain): base entity types`.

### Task 5: Typed options with fail-fast validation
**Files:**
- Create: `src/EnterpriseRag.Shared/Options/{DatabaseOptions.cs,AiOptions.cs,OllamaOptions.cs,RagOptions.cs}`, `src/EnterpriseRag.Shared/Options/OptionsRegistration.cs`, `tests/EnterpriseRag.Application.Tests/Options/OptionsValidationTests.cs` (Shared options are tested from the Application test project)

**Interfaces:** Produces `DatabaseOptions { string ConnectionString }`; `AiOptions { string Provider = "Ollama"; OllamaOptions Ollama }`; `OllamaOptions { string BaseUrl = "http://localhost:11434"; string ChatModel = "qwen3:8b"; string EmbeddingModel = "nomic-embed-text"; int EmbeddingDimensions; int TimeoutSeconds = 180 }`; `RagOptions { int ChunkSize = 700; int ChunkOverlap = 100; int TopK = 5 }`; `IServiceCollection AddValidatedOptions<T>(this IServiceCollection, IConfiguration, string section)` using DataAnnotations + `ValidateOnStart`.

- [ ] **Step 1:** Write failing tests: `EmptyConnectionString_FailsValidation`; `NonHttpOllamaBaseUrl_FailsValidation`; `ChunkOverlap_GreaterOrEqualChunkSize_FailsValidation`; `TopK_Zero_FailsValidation`; `Defaults_MatchSpec` (asserts the exact default values above).
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement options and registration; embedding model/dimensions have no business-logic hardcoding (defaults only live in these option classes; EmbeddingDimensions has no default and must be configured — required).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): validated typed options`.

### Task 6: EF Core persistence, audit interceptor, soft delete, first migration
**Files:**
- Create: `src/EnterpriseRag.Domain/Audit/AuditLog.cs`, `src/EnterpriseRag.Infrastructure/Persistence/{AppDbContext.cs,AuditableEntityInterceptor.cs,Configurations/AuditLogConfiguration.cs}`, `src/EnterpriseRag.Infrastructure/DependencyInjection.cs` (`AddInfrastructure(IServiceCollection, IConfiguration)`), `src/EnterpriseRag.Infrastructure/Time/SystemDateTimeProvider.cs`, `src/EnterpriseRag.Infrastructure/Persistence/Migrations/*`, `tests/EnterpriseRag.Infrastructure.Tests/Persistence/PersistenceTests.cs`

**Interfaces:**
- Consumes: Task 4 base types, Task 5 `DatabaseOptions`.
- Produces: `AppDbContext(DbContextOptions<AppDbContext>)` with `DbSet<AuditLog> AuditLogs`; `AuditLog : Entity { string Action; string? ActorId; string? TargetType; string? TargetId; DateTime OccurredAt; string? DetailsJson; }` (append-only; no update/delete path); global query filter on `SoftDeletableEntity.IsDeleted == false`; interceptor sets CreatedAt/UpdatedAt/CreatedBy/UpdatedBy from `IDateTimeProvider`/`ICurrentUserService`.

- [ ] **Step 1:** Write failing Testcontainers-SQL-Server tests (shared fixture): `SaveChanges_SetsCreatedAtFromDateTimeProvider` (fake provider returns fixed UTC value); `SoftDeletedEntity_IsExcludedFromDefaultQuery_ButVisibleWithIgnoreQueryFilters` (use a test-only `SoftDeletableEntity` subclass mapped in a test context); `AuditLog_RoundTrips`.
- [ ] **Step 2:** Run — Expected: FAIL (Docker must be running; if it isn't, report and stop).
- [ ] **Step 3:** Implement context, configuration (explicit entity configs, index on `AuditLog(OccurredAt)`), interceptor and DI; generate migration `InitialCreate` with `dotnet ef migrations add` (verify `dotnet-ef` tool compat with .NET 11).
- [ ] **Step 4:** Add a test `Migrations_ApplyCleanly_ToEmptyDatabase`; run all Infrastructure tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(infra): EF Core context, audit, soft delete, initial migration`.

### Task 7: API composition — logging, correlation ID, error handling, Swagger
**Files:**
- Create: `src/EnterpriseRag.API/{Program.cs,Middleware/CorrelationIdMiddleware.cs,Middleware/GlobalExceptionHandler.cs,Services/HttpCurrentUserService.cs}`, `tests/EnterpriseRag.API.IntegrationTests/{ApiFactory.cs,CorrelationIdTests.cs,ErrorHandlingTests.cs}`
- Modify: `src/EnterpriseRag.Worker/Program.cs` (same Serilog + options registration)

**Interfaces:** Consumes Tasks 5–6. Produces: `CorrelationIdMiddleware` (header `X-Correlation-ID`, pushed to Serilog `LogContext`, echoed on response); `GlobalExceptionHandler : IExceptionHandler` mapping `DomainException`→400, unknown→500 as ProblemDetails; Swagger enabled only in Development; a test-only endpoint is not shipped — tests register one via the factory.

- [ ] **Step 1:** Write failing tests: `ValidCorrelationId_IsEchoed`; `MissingCorrelationId_GeneratesGuid`; `HostileCorrelationId_OversizedOrWithNewlines_IsReplaced`; `UnhandledException_Production_ReturnsProblemDetailsWithoutStackTrace`; `DomainException_Returns400ProblemDetails`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement middleware (accept only `^[A-Za-z0-9\-_.]{1,64}$`), handler, Serilog (console, JSON in non-Development, request logging), Swagger, `HttpCurrentUserService` (null user for now).
- [ ] **Step 4:** Run API integration + architecture tests — Expected: PASS (architecture test confirms API controllers/Program don't leak Infrastructure types into Application).
- [ ] **Step 5:** Commit `feat(api): logging, correlation id, problem details`.

### Task 8: Health checks (liveness vs readiness)
**Files:**
- Create: `src/EnterpriseRag.API/Health/HealthEndpoints.cs`, `tests/EnterpriseRag.API.IntegrationTests/HealthTests.cs`
- Modify: `src/EnterpriseRag.API/Program.cs`, `src/EnterpriseRag.Infrastructure/DependencyInjection.cs` (SQL check)

**Interfaces:** Produces `GET /health/live` (no dependencies, always 200 if process runs), `GET /health/ready` (SQL Server required; response body lists check names/status only, no connection strings or exception text). Ollama/Qdrant/Redis/RabbitMQ checks are added in the phases that introduce them, as non-critical (degraded) checks.

- [ ] **Step 1:** Write failing tests: `Live_Returns200_EvenWhenDatabaseUnreachable`; `Ready_Returns200_WhenDatabaseUp`; `Ready_Returns503_WhenDatabaseDown`; `Ready_Body_DoesNotContainConnectionString`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement with tags `live`/`ready` and a response writer that omits exception/data.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): liveness and readiness health checks`.

### Task 9: Local environment (Docker Compose) and CI
**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`, `docs/INFRASTRUCTURE.md`
- Modify: `src/EnterpriseRag.API/appsettings.Development.json` (no secrets; connection string read from env/user-secrets)

**Interfaces:** Compose service `sqlserver` (named volume, healthcheck, port bound to `127.0.0.1:1433`, SA password from `.env`); CI jobs: restore, build (Release), test all backend tests incl. architecture tests, on push and pull_request.

- [ ] **Step 1:** Write `docker-compose.yml` and `.env.example` (placeholder password only); confirm `.env` is git-ignored.
- [ ] **Step 2:** `docker compose config` — Expected: valid; `docker compose up -d sqlserver` then wait for healthy — Expected: `healthy`.
- [ ] **Step 3:** Run API against Compose SQL (connection string via user-secrets), apply migration, request `/health/ready` — Expected: HTTP 200.
- [ ] **Step 4:** Write `ci.yml`; validate YAML syntax locally (e.g. `actionlint` if available, else careful review) and note that the first real run happens when pushed to GitHub.
- [ ] **Step 5:** Commit `chore: docker compose sql server and ci workflow`.

### Task 10: Milestone verification and progress update
**Files:**
- Modify: `docs/PROJECT_PROGRESS.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1:** Using verification-before-completion: run `dotnet build -c Release` and `dotnet test` for the whole solution — Expected: 0 warnings, all tests pass; record actual counts.
- [ ] **Step 2:** Update `PROJECT_PROGRESS.md`: Phase 1 complete (with verified evidence), known issues (CI not yet run on GitHub, any package fallbacks), next task = Phase 2 plan (Identity & KBs; start with brainstorming-sized check of invite/admin flow and RTL i18n setup).
- [ ] **Step 3:** Request code review (requesting-code-review) over the Phase 1 diff; address findings via receiving-code-review.
- [ ] **Step 4:** Commit `docs: phase 1 complete`.

---
## Self-review notes
- Spec coverage for Phase 1 (spec §10): solution/Onion ✓ T2–T3, DI/config ✓ T5–T6, logging/exceptions ✓ T7, health ✓ T8, SQL/EF/migration ✓ T6, architecture tests ✓ T3, Compose SQL + basic CI ✓ T9, docs/PROJECT_PROGRESS/ADRs ✓ T1/T10. Deferred by design: all other services, auth, Angular scaffold (Phase 2, after Angular/Node 26 compatibility is recorded in T1).
- Consistent names: `IDateTimeProvider.UtcNow`, `ICurrentUserService.UserId`, `AddInfrastructure`, `AddValidatedOptions<T>` used identically across tasks.
