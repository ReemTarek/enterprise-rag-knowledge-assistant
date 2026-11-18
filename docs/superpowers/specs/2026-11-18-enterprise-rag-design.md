# Enterprise RAG Knowledge Assistant — Design

Date: 2026-11-18 · Status: DRAFT, awaiting approval · Scope: whole product; implementation is phased (see Phases).

## 1. Intent and why
A secure, multi-user assistant where members of one organization upload internal documents (PDF, DOCX, TXT) into knowledge bases, ask natural-language questions, and get answers grounded in those documents with citations (document, page). Strict per-user authorization is the defining requirement: no document, chunk, search hit, conversation or notification may reach a user who is not entitled to it. The user did not state a business motive; **assumption (my call): a real product for a single organization**, built to production standards but MVP-first.

## 2. Goals / non-goals / anti-goals
**Goals:** working grounded Q&A with citations; KB sharing with roles; reliable async ingestion; real-time + push notifications; installable PWA; reproducible local env (Docker Compose); CI on GitHub Actions; docs and progress file kept current.
**Non-goals (now):** multi-tenancy (no `TenantId`), OCR for scanned PDFs, formats beyond PDF/DOCX/TXT, any cloud provisioning or spend, microservices, offline RAG.
**Anti-goals (failure even if it "works"):** any cross-user data leak; answers that invent facts; silently mixing embedding models in one index; losing an event or duplicating vectors on retry; private data in the PWA cache; secrets in git.

## 3. Constraints
- Backend: ASP.NET Core, C#, EF Core, SQL Server, FluentValidation, Serilog, Swagger, SignalR. **.NET: installed SDK 11.0.100 (user decision, not LTS)** — pinned via `global.json`; revisit before production.
- Frontend: Angular + PWA. **Node 26 installed (user decision, non-LTS)**; Phase 1 must first verify Angular CLI supports it, else report and ask.
- AI: Ollama only (`qwen3:8b` chat; embeddings default `nomic-embed-text`, to be replaced by a multilingual model per §11c, `http://localhost:11434`), all configurable; no Gemini. Qdrant `http://localhost:6333`.
- Infra: SQL Server, Qdrant, S3 (private), Redis, RabbitMQ + MassTransit, Hangfire, Docker/Compose, GitHub Actions + GHCR.
- Verify library docs/versions/licences (notably MassTransit, MinIO) before adopting each; no paid services without approval.
- Git repo exists on `main`; commits per milestone.

## 4. Approaches considered
- **A. Modular monolith, MVP-first (CHOSEN by user).** API + Worker host from one codebase. Phases 1–5 run ingestion in-process behind an `IIngestionQueue` port (SQL-backed queue + hosted service). Phase 6 replaces the adapter with RabbitMQ/MassTransit + outbox/inbox; use cases unchanged. Trade-off: a small queue adapter is written twice.
- B. Full architecture from day one (all services in Phase 1). Rejected: ~8 services before first answer; RAG-quality bugs entangled with infra bugs.
- C. Split Ingestion/Chat services with separate DBs. Rejected: needless for one organization; cross-service authz risk.

## 5. Architecture
Onion layers: `Domain ← Application ← Infrastructure ← API / Worker`; `Shared` holds integration-event contracts and option types. Domain and Application reference no provider packages. NetArchTest tests enforce directions and "controllers contain no business logic".

```
src/  EnterpriseRag.{Domain,Application,Infrastructure,API,Worker,Shared}
tests/ Domain.Tests, Application.Tests, Infrastructure.Tests, API.IntegrationTests, Architecture.Tests
frontend/enterprise-rag-web     docs/     (files listed in the master prompt + ADRs)
```
Application style: feature folders with plain command/query handler classes (no MediatR — licensing). Ports: `IChatCompletionService`, `IEmbeddingService`, `IVectorStore`, `IFileStorageService`, `ICacheService`, `IDocumentProcessor`, `INotificationService`, `ICurrentUserService`, `IDateTimeProvider`, `IIngestionQueue`, `IAccessPolicy`.

**Responsibility split:** ingestion pipeline = `IIngestionQueue` (SQL-backed → later RabbitMQ consumers). Hangfire = time-based/recurring only (stale-processing sweeper, cleanup, push-subscription pruning, reconciliation); it never runs the pipeline. SignalR = live notifications (authenticated, group `user:{id}`); chat tokens stream over SSE. Web Push (VAPID) for offline devices; Notification row is persisted first, delivery best-effort. Redis = cache only, versioned/permission-scoped keys, introduced in Phase 7 after measurement.

## 6. Domain / data (summary; detail goes in docs/DOMAIN_MODEL.md, DATABASE_DESIGN.md)
Entities: ApplicationUser/Role/UserRole (ASP.NET Core Identity), KnowledgeBase, KnowledgeBaseUser (role Owner/Editor/Viewer; unique KbId+UserId), Document (CurrentVersionId), DocumentVersion (S3Key, Sha256, Status, IndexConfigId, RowVersion), **IndexConfiguration** (embedding model, dimensions, Qdrant collection, chunk params, status Building/Active/Retired), DocumentChunk (metadata only; chunk text lives in Qdrant payload — rebuild source is the S3 original), Conversation, ChatMessage, MessageSource, Notification, NotificationPreference, PushSubscription, AuditLog, OutboxMessage/InboxMessage (Phase 6). UTC audit fields, soft delete via global filters, `rowversion` on KB/Document/Version. Version lifecycle: Pending→Uploading→Uploaded→Processing→Indexed|Failed; Indexed→Deleting→Deleted; Failed→Processing on retry; only Indexed+active versions are queryable; old version stays live until new one is Indexed (atomic pointer flip).

## 7. RAG design
Extract (PdfPig page-aware; OpenXML for DOCX with heading metadata instead of pages; TXT) → normalize (NFC, whitespace, hyphenation) → token-aware chunk (~700/100 overlap, configurable, page ranges kept) → batched embed via adapter (task prefixes for `nomic-embed-text` verified at implementation) → upsert to Qdrant with deterministic point IDs (hash of versionId+chunkIndex) so retries overwrite. One Qdrant collection per IndexConfiguration (cosine; payload indexes on kbId, documentId, versionId, isActive). Query path: authenticate → membership from SQL (source of truth) → embed question → search filtered by server-derived kbId + active versions → score threshold; none pass ⇒ "insufficient information" without calling the LLM → versioned system prompt with delimited untrusted context blocks → stream answer → strip citations not mapping to retrieved chunks → persist message + MessageSource. Index config is validated against live config on every query/ingest; mismatch is refused. Model change ⇒ new Building index, background reindex, validate, atomic activate, old retired later. Ollama adapter: typed HttpClient, resilience only for transient errors, health check incl. model presence, `<think>` handling for qwen3.

## 8. Security (summary → docs/SECURITY.md)
Central `IAccessPolicy` in every handler; foreign-user tests on every endpoint; client never supplies vector filters; upload allow-list + magic bytes + size cap + generated S3 keys + ZIP-bomb limits; private bucket, SSE, presigned URLs only after authz, never stored; cache keys include user/permission version/index version; ID-only message payloads; secrets via user-secrets/env; Hangfire dashboard authenticated; audit log for auth, upload/delete, sharing, permission, admin actions.
**Auth (my call):** ASP.NET Core Identity + short-lived JWT, refresh token in HttpOnly cookie; OIDC later.

## 9. Local environment
Compose: SQL Server, Qdrant, Redis, RabbitMQ, S3-compatible store (MinIO/LocalStack, licence checked first), API, Worker, Web; Ollama native on host (`host.docker.internal:11434` from containers); named volumes, healthchecks, ports bound to 127.0.0.1, `.env.example`, multi-stage non-root images.

## 10. Phases (each gets its own plan via writing-plans, with tasks, tests, DoD)
1 Foundation → 2 Identity & KBs → 3 Documents → 4 RAG & Ollama (in-process ingestion) → 5 Conversations & SSE streaming → 6 RabbitMQ/MassTransit/outbox/Hangfire → 7 Redis → 8 Notifications (SignalR, Web Push) → 9 PWA → 10 Security & quality → 11 Docker/CI/CD hardening (basic CI starts in Phase 1) → 12 Deployment readiness (cost estimate; no cloud spend without approval). Dependencies are sequential except 7/8/9, which can reorder after 6. Phase 1 starts by creating `docs/` incl. `PROJECT_PROGRESS.md` and ADRs for the decisions above.

## 11. Decisions made as my calls (user may override)
Single organization; Identity+JWT; no MediatR; chunk text in Qdrant payload; SSE for chat streaming; MinIO/LocalStack dev S3 pending licence check; Worker as separate host (single process allowed via config in early phases); .NET 11 / Node 26 per user, flagged non-LTS.

## 11b. Reviewer-check resolutions (my calls, mark for user review)
- **Self-contained:** the required docs set is `docs/{ARCHITECTURE,DOMAIN_MODEL,DATABASE_DESIGN,RAG_PIPELINE,AI_PROVIDER,SECURITY,API_DESIGN,INFRASTRUCTURE,DEPLOYMENT,IMPLEMENTATION_ROADMAP,PROJECT_PROGRESS}.md` + `docs/ARCHITECTURE_DECISIONS/`. `PROJECT_PROGRESS.md` records phase, milestones, file locations, pending work, known issues, failing tests, next task; updated after every milestone and read first in any new session.
- **MVP cut:** the first stakeholder-visible "ask a question, get a cited answer" is the end of Phase 4. Angular UI is built incrementally with each phase (login+KB list in 2, upload/status in 3, chat in 4, conversations in 5); Phases 8–9 add only notification UI and PWA features.
- **Dev S3:** preference order LocalStack → MinIO (only if licence/maintenance check passes) → Garage; a `LocalFileStorage` adapter is used for unit/integration tests. The port hides the choice.
- **Verification before use:** every package is checked for .NET 11 support when first added; an incompatible one is reported, not silently worked around.

## 11c. User answers to reviewer questions (confirmed by user)
1. **Fallback pre-approved:** if a package or Angular CLI is incompatible with .NET 11 / Node 26, the builder may drop to .NET 10 LTS / Node LTS without asking; record an ADR.
2. **Accounts:** a seeded first admin; the admin creates all other users (no self-registration, no email sending in MVP; credentials/invite shown to the admin). Global Admin manages users but cannot read KB content unless also a KB member (my default, accepted via "ok" on neighbouring items — flag if wrong).
3. **Sharing:** Owner adds members from the user directory (name+email visible to authenticated users). Removal revokes access immediately, including to the removed user's own history about that KB; citations are re-authorized when history is read.
4. **Conversation scope:** one conversation = exactly one KB.
5. **Scale targets:** ~50 users, ~20 concurrent chats, ~500 documents per KB, 25 MB max file; chat requests go through a concurrency limit/queue because one Ollama host is the bottleneck.
6. **Languages: Arabic, English and German** documents and questions. Consequences: (a) `nomic-embed-text` is English-centric, so the default embedding model must be a multilingual one — **my proposal: `bge-m3` (1024 dims) via Ollama, to be verified for availability, quality and licence before adoption and evaluated on a small Arabic/English/German golden set; `nomic-embed-text` remains a configurable alternative**; (b) the chunker's tokenizer approximation and normalization must handle Arabic script (diacritics, tatweel, RTL) without corrupting text; (c) the Angular UI supports RTL layout and i18n (ar/en/de) from Phase 2 onward; (d) the system prompt instructs answering in the question's language; (e) page/citation display works for RTL.
7. **Retention:** user delete = hard purge of S3 object, vectors and chunk metadata within 24 h after a short soft-delete window; audit logs kept 1 year; no specific compliance requirements.

## 12. Left to the builder
Exact package choices/versions (after doc verification), chunker tokenizer approximation, score threshold and prompt wording (tuned against a golden Q&A set), UI layout/Material theming, index naming details, retry/backoff numbers.
