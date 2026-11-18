# Project Progress

## Current phase
Phase 1: Foundation - implementation complete on branch `phase-1-foundation`, pending whole-branch review. NOT merged to main. Runtime verification is incomplete (see "Failing tests / outstanding validation").

## Completed milestones (branch phase-1-foundation, from main @ f3df10c)
- f3df10c Baseline: superpowers skills, design spec, Phase 1 plan
- Task 1 (2005fc1): toolchain verified, docs scaffold, ADRs, global.json
- Task 2 (fc0e606): solution skeleton (Domain, Application, Infrastructure, API, Worker, Shared + test projects)
- Task 3 (9d58a1a): architecture dependency-rule tests
- Task 4 (aa2f0c0): Domain base entity types (soft delete, audit)
- Task 5 (cae5174, 4ead26c): validated typed options (incl. nested Ollama validation fix)
- Task 6 (fcb1522): EF Core context, audit, soft delete, initial migration
- Task 7 (10790c9, 363a06f): Serilog logging, correlation id, ProblemDetails; Worker appsettings fix and startup smoke test
- Task 8 (f26892e): liveness and readiness health checks
- Task 9 (b0a09c1): Docker Compose SQL Server and CI workflow
- Task 10: this verification and progress update

## Status
Code for all Phase 1 tasks is committed and each task passed its per-task review. Final verification run (2026-11-18, Release):
- `dotnet build EnterpriseRag.sln -c Release` (also `--no-incremental`): 0 warnings, 0 errors.
- `dotnet test EnterpriseRag.sln -c Release`: could NOT be confirmed. Windows Application Control / Smart App Control blocked freshly built unsigned DLLs (0x800711C7, "An Application Control policy has blocked this file"). Result was the same across 4 runs, including after a full rebuild:
  - Domain.Tests: 3/3 passed in the first run only; blocked (FileLoadException) in later runs
  - Application.Tests: 0/13 passed (13 failed, FileLoadException on EnterpriseRag.Shared.dll)
  - Infrastructure.Tests: not run (FileLoadException on EnterpriseRag.Application.dll)
  - Architecture.Tests: 0/28 passed (all failed, FileLoadException on EnterpriseRag.Application.dll)
  - API.IntegrationTests: not run (FileLoadException on EnterpriseRag.API.dll)
  These are environment failures, not assertion failures. Earlier per-task reviews recorded these projects green (e.g. Architecture 28/28 and Domain 3/3 at fcb1522). No passing counts are claimed for this final run beyond the above.
- End-to-end (compose SQL Server, `dotnet ef database update`, API `/health/live` and `/health/ready`): the SQL Server container became healthy; `dotnet ef` built but failed to create AppDbContext (Application Control blocked Application.dll); the API failed to start (blocked API.dll), so no health status codes were obtained. Containers and volumes removed; the throwaway `.env` was deleted. No OS security feature was disabled.

## Decisions
- ADR 0001 Onion architecture
- ADR 0002 Ollama provider (embedding model to be verified in Phase 4)
- ADR 0003 .NET 11 / Node 26 toolchain (Angular 22 supports Node 26)
- Ruling: Worker has no Database section / AddInfrastructure until Phase 6 (consumers). The Worker cannot touch the DB until then.
- Serilog.AspNetCore pinned to 10.0.0 and Swashbuckle to 11.0.0 because the dev machine's application-control policy blocks the newer unsigned binaries (Serilog.Extensions.Hosting 11.0.0, Swashbuckle.SwaggerUI 11.0.1).
- appsettings `Ai:EmbeddingDimensions` = 768 is the nomic default; it changes with the Phase 4 multilingual embedding model decision.
- Global soft-delete query filter applied by convention over all SoftDeletableEntity types in AppDbContext.

## Important file locations
- Spec: docs/superpowers/specs/2026-11-18-enterprise-rag-design.md
- Plan: docs/superpowers/plans/2026-11-18-phase1-foundation.md
- ADRs: docs/ARCHITECTURE_DECISIONS/
- Architecture: docs/ARCHITECTURE.md; Roadmap: docs/IMPLEMENTATION_ROADMAP.md; Infrastructure: docs/INFRASTRUCTURE.md
- Solution: EnterpriseRag.sln; src/EnterpriseRag.*; tests/EnterpriseRag.*
- Compose: docker-compose.yml (+ .env.example); CI: .github/workflows/ci.yml
- Migration: src/EnterpriseRag.Infrastructure (initial migration)

## Pending work
- Phase 1 whole-branch code review, then merge decision.
- Re-run the full test suite and the end-to-end check where Application Control does not block built DLLs.
- Phase 2 plan.

## Known issues
Environment:
- Windows Smart App Control / Application Control blocks freshly built unsigned DLLs (0x800711C7), intermittently in earlier tasks and consistently in this Release verification.
- CI has not yet run on GitHub; SDK 11.0.100 resolution via setup-dotnet is unverified; ci.yml YAML unparsed.
- docs/INFRASTRUCTURE.md `dotnet ef database update` command unverified end to end (arguments were accepted, DbContext creation was blocked); consider adding `--configuration Release`; doc shows the password inline in example commands.

Deferred minor findings by task:
- Task 2: .sln NestedProjects wrong (API/Infrastructure nested under tests; Worker, Infrastructure.Tests, Architecture.Tests at root); empty PropertyGroups in csproj.
- Task 3: no "Shared has no deps" architecture test; no Domain/Application referenced-assemblies check; rule context missing from failure messages.
- Task 4: no Unspecified-Kind test; "Twice" soft-delete test does not assert DeletedAt unchanged; Id public setter / default Empty.
- Task 5: add SectionName consts on options classes (casing "AI" vs "Ai"); missing tests for TimeoutSeconds<=0, empty ChatModel/EmbeddingModel, absent Database section; host-start test asserts only exception type, not message naming the failing property.
- Task 6: bulk ExecuteUpdate/ExecuteDelete bypass of AuditLog guard undocumented; datetime2 reads back Kind=Unspecified (no UTC ValueConverter, affects UTC consistency); sync SaveChanges untested; migration test weak (add HasPendingModelChanges); migration class named _2026..._InitialCreate; DI resolution test carried to Task 7.
- Task 7: test names (..._OversizedOrWithNewlines_IsReplaced covers the no-newline case; one mentions Worker but covers API too); verify exception logged once (ExceptionHandlerMiddleware may also log); Worker uses Serilog.AspNetCore (heavier than Extensions.Hosting + Console); no Serilog bootstrap logger; no comment on version pins in Directory.Packages.props; ADR 0002 lacks a note that EmbeddingDimensions 768 changes in Phase 4; no Swagger-in-Development test; CR/LF correlation test calls middleware directly; Development appsettings only JSON-validated, not options-validated.
- Task 8: readiness check has no explicit timeout (SqlClient default ~15s); "ready" tag literal duplicated between Infrastructure and API; each HealthTests instance starts its own MsSql container (~40s total; share a fixture); sentinel test healthy case does not assert host/port.
- Task 9: ci.yml has no timeout-minutes/concurrency; push + pull_request double runs; bare `dotnet restore/test` relies on a single .sln (use explicit path).

## Failing tests/outstanding validation
- Final Release test run could not be confirmed due to Application Control blocking (see Status). The failures observed (Application.Tests 13, Architecture.Tests 28, plus unrun Infrastructure/API test projects) are FileLoadException environment failures, not assertion failures.
- End-to-end migration + health check not completed (blocked, see Status).
- Embedding model choice (bge-m3 / multilingual) to verify in Phase 4.

## Next task
1. Phase 1 whole-branch review (and re-verification of tests and e2e where DLLs load).
2. Phase 2 plan: Identity and Knowledge Bases (seeded admin + admin-created users, KB sharing, Angular + RTL i18n ar/en/de setup).
