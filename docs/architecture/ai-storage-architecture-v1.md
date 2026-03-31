# Lyra AI Storage Architecture V1

## V2 Memory Extension
This document defines the V1 storage baseline.

Session-isolated memory, trim-archive strategy, shared/frozen memory, and dynamic prompt injection are locked in:
- `docs/architecture/ai-memory-architecture-v2.md`

Use both documents together:
- V1: storage ownership and baseline constraints
- V2: concrete memory pipeline and lifecycle policy

## Purpose
Define a stable, modular storage baseline for AI sessions, memory, and runtime artifacts in Lyra.

This document locks V1 choices and reserves clear extension points for future multi-device sync.

## V1 Decisions (Confirmed)
Lyra AI storage uses a layered hybrid model:

1. **SQLite (source of truth)**
- Stores: sessions, messages, task states, approval records, reference links, memory metadata.
- Why: strongest local consistency on desktop, transactional safety, rich query capability, near-zero ops overhead.

2. **File system (`~/.lyra/modules/ai/*`)**
- Stores: large texts, attachments, code snapshots, diff artifacts, index snapshots.
- Why: large objects are cheaper and simpler in files than in relational rows.

3. **Vector retrieval (SQLite-first)**
- Uses: `SQLite + FTS5 + sqlite-vec (or equivalent local vector extension)`.
- Why: semantic memory retrieval is needed, but V1 does not need a standalone vector database process.

## Optional Component: Redis
Redis is **optional** and **not** part of V1 truth storage.

If introduced later, Redis is for:
- cache acceleration
- event fan-out
- short-lived coordination state

Redis must not become the authoritative store for AI sessions/messages/tasks.

## Storage Root and Domain Boundary
All AI data lives under:
- `~/.lyra/modules/ai/`

Recommended V1 layout:
```
~/.lyra/modules/ai/
  db/
    ai.v1.sqlite
  blobs/
    attachments/
    large-text/
  snapshots/
    code/
    task/
  diffs/
  indexes/
    fts/
    vector/
  temp/
```

Boundary rules:
- AI domain writes only through AI storage service/bridge.
- Other modules do not write AI data directly.
- Renderer never writes AI truth data directly to browser storage.

## Data Ownership Model
### SQLite owns
- Conversation/session graph
- Message timeline and role metadata
- Runtime task lifecycle and decision state
- Approval/audit records
- Reference relationships (`quote`, `reply-to`, `task-link`)
- Memory metadata (identity, tags, timestamps, source)

### File system owns
- Large payload bodies (threshold-driven)
- Binary attachments
- Code snapshots and patch artifacts
- Rebuildable index snapshots

### Vector layer owns
- Embedding vectors and ANN lookup metadata
- Keyword + semantic retrieval fusion index state

## Multi-Device Sync Readiness (V1 Requirements)
Even before sync is enabled, schema and IDs must be sync-friendly.

Required design constraints:
1. Every sync-relevant row has stable global IDs.
2. Every mutable entity has monotonic update fields (`updated_at`, logical version).
3. Deletions use tombstones where needed (no hard delete for sync-critical entities by default).
4. Append-only event/audit stream is preserved for replay and conflict inspection.
5. Storage model separates:
- device-local ephemeral state
- sync-candidate durable state

## Suggested V1 Sync-Safe Fields
For sync-candidate entities:
- `id` (stable string id)
- `created_at`
- `updated_at`
- `deleted_at` (nullable tombstone)
- `version` (integer or vector-compatible field)
- `device_id` / `author_id` (where applicable)

## Conflict Strategy (Forward-Compatible)
V1 should keep conflict handling simple and deterministic:
- Message timeline: append-only, avoid in-place rewrite
- Task state: explicit transition records + latest projection
- Lightweight metadata: last-write-wins with audit trail

## Migration Rules
V1 is a hard-cut baseline:
- no compatibility with removed legacy local storage paths
- schema migrations are explicit and versioned
- no silent schema reinterpretation

SQLite migration requirements:
- track DB schema version
- forward-only migration scripts
- startup fails fast on migration failure

## Guardrails
1. No AI truth in `localStorage/sessionStorage`.
2. No module bypassing AI storage service.
3. No introducing secondary truth stores without ownership decision.
4. Redis (if added) must be cache/coordination only, not truth.
5. Vector storage must stay local-first in V1.

## Non-Goals (V1)
- No cloud database dependency required at runtime.
- No mandatory external vector DB service.
- No distributed lock manager requirement.
- No full cross-device conflict UI yet.

## Evolution Path
Phase A (current): local-first hybrid storage.

Phase B (sync intro): add sync adapter/service while keeping local SQLite authoritative per device.

Phase C (multi-device scale): optional centralized sync backend, Redis cache/event layer, stronger conflict tooling.
