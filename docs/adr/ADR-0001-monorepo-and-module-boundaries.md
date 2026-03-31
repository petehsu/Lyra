# ADR-0001: Monorepo and Strict Module Boundaries

Status: Accepted
Date: 2026-03-26

## Decision
Use a monorepo with clear layer boundaries:
- App
- Services
- System
- Shared Contracts

Enforce structural guardrails with tooling (`tools/verify-boundaries.ts`).

## Consequences
- Easier long-term refactoring
- Reduced risk of monolith growth
- Higher initial discipline requirements
