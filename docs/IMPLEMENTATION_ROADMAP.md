# Implementation Roadmap

Source: spec section 10. Each phase gets its own plan with tasks, tests and definition of done.

1. Foundation
2. Identity & KBs
3. Documents
4. RAG & Ollama (in-process ingestion)
5. Conversations & SSE streaming
6. RabbitMQ / MassTransit / outbox / Hangfire
7. Redis
8. Notifications (SignalR, Web Push)
9. PWA
10. Security & quality
11. Docker / CI/CD hardening (basic CI starts in Phase 1)
12. Deployment readiness (cost estimate; no cloud spend without approval)

Dependencies are sequential except 7/8/9, which can reorder after 6.
