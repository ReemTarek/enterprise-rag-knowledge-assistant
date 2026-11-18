# Architecture (stub)

Source: docs/superpowers/specs/2026-11-18-enterprise-rag-design.md section 5. Decisions: see docs/ARCHITECTURE_DECISIONS/.

Onion layers: `Domain <- Application <- Infrastructure <- API / Worker`; `Shared` holds integration-event contracts and option types.

```
src/  EnterpriseRag.{Domain,Application,Infrastructure,API,Worker,Shared}
tests/ EnterpriseRag.{Domain.Tests,Application.Tests,Infrastructure.Tests,API.IntegrationTests,Architecture.Tests}
frontend/enterprise-rag-web     docs/
```

## Implemented in Phase 1
- Health endpoints: `/health/live` (liveness) and `/health/ready` (readiness, includes SQL Server check).
- Correlation id middleware (sanitised inbound header, echoed on the response, attached to logs) and Serilog logging.
- Global exception handling returning RFC 7807 ProblemDetails.
- Persistence base: EF Core `AppDbContext`, audit fields, soft delete with global query filter, initial migration; validated typed options (`ValidateOnStart`).

To be expanded as phases land.
