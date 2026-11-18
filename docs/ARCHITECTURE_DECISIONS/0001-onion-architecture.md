# ADR 0001: Onion architecture

Status: Accepted

## Context
The system integrates many replaceable providers (Ollama, Qdrant, SQL Server, Redis, RabbitMQ, S3). Business rules must stay testable and independent of them.

## Decision
Layers: `Domain <- Application <- Infrastructure <- API / Worker`; `Shared` holds integration-event contracts and option types. Domain and Application reference no provider packages. Application uses feature folders with plain command/query handler classes (no MediatR, due to licensing). Ports (`IChatCompletionService`, `IEmbeddingService`, `IVectorStore`, ...) live in Application and are implemented in Infrastructure. NetArchTest tests enforce dependency directions and that controllers contain no business logic.

## Consequences
- Providers can be swapped without touching business logic; handlers are unit-testable with fakes.
- More projects and mapping boilerplate.
- Architecture tests are required to prevent drift.
