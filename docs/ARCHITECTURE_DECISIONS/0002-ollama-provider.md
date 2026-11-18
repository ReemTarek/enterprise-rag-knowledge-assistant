# ADR 0002: Ollama as AI provider

Status: Accepted (embedding model proposed, to be verified)

## Context
The system needs local, cost-free chat completion and embeddings during development, behind provider-neutral ports.

## Decision
Use Ollama running natively on the host (`host.docker.internal:11434` from containers), behind `IChatCompletionService` and `IEmbeddingService`.
- Chat model: `qwen3:8b`.
- Embedding model: the default is to be replaced by a multilingual model. Proposed: `bge-m3`. To be verified in Phase 4 (quality, dimension, performance).

## Consequences
- Changing the embedding model changes vector dimensions and semantics, so it requires a reindex strategy (versioned collections, re-embedding of all chunks, then switch-over). This must be designed before the first production-like data is indexed.
- Quality and latency depend on local hardware.
- The ports allow another provider later.
