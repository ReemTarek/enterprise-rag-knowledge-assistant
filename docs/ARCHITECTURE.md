# Architecture (stub)

Source: docs/superpowers/specs/2026-11-18-enterprise-rag-design.md section 5. Decisions: see docs/ARCHITECTURE_DECISIONS/.

Onion layers: `Domain <- Application <- Infrastructure <- API / Worker`; `Shared` holds integration-event contracts and option types.

```
src/  EnterpriseRag.{Domain,Application,Infrastructure,API,Worker,Shared}
tests/ Domain.Tests, Application.Tests, Infrastructure.Tests, API.IntegrationTests, Architecture.Tests
frontend/enterprise-rag-web     docs/
```

To be expanded as phases land.
