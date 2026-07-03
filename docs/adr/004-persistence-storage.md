# 004. Persistence & Storage Strategy

Status: Accepted

## Context

Two very different kinds of data need durable storage: small, queryable Project/
Membership metadata, and larger, opaque Document content (the Yjs CRDT state) that is
never queried by field, only loaded/saved whole.

## Alternatives Considered

- **Single relational database (e.g. Aurora/RDS Postgres) for everything.**
- **DynamoDB for metadata + S3 for Document blobs** (split by access pattern).
- **S3-only for everything**, including metadata as small JSON files, no database.

## Decision

DynamoDB for Project + ProjectMembership metadata; S3 for Document (Yjs) snapshot
blobs.

## Pros / Cons

**Chosen (DynamoDB + S3 split)**
- Pros: matches each data shape to the storage built for it — DynamoDB's key-based
  access fits "get project by id" / "list projects by owner" exactly, with no server to
  manage and generous free tier at POC scale. S3 is the natural fit for opaque binary
  blobs (Yjs snapshots) with built-in versioning as a free safety net. Neither needs
  provisioning, patching, or connection-pool management — fully aligned with
  NFR-MAINT-2.
- Cons: two storage systems instead of one, and no cross-entity SQL joins/transactions
  if metadata needs grow more relational later (mitigated by how simple POC access
  patterns are today).

**Rejected (single relational DB)**
- Pros: one system, SQL joins/transactions available if the domain model grows more
  relational.
- Cons: RDS/Aurora is a provisioned (or Aurora Serverless v2, still non-trivial)
  database a solo developer now has to size, patch, and pay a baseline for, to solve a
  problem (a handful of projects, simple key lookups) that doesn't need it yet.

**Rejected (S3-only, no database)**
- Pros: single storage system, arguably even cheaper at zero scale.
- Cons: "list my projects" / "list projects shared with me" becomes hand-rolled
  indexing over S3 object listings — reinventing exactly what DynamoDB already does
  well, for no real savings at POC scale.

## Long-Term Implications

Locks in: metadata queries expressed as DynamoDB access patterns (single-table or
per-entity tables) rather than SQL — if the domain later needs genuinely relational
queries (complex marketplace search, reporting), that's an additive service, not a
rip-and-replace of this data. Keeps open: S3-stored Document snapshots can be migrated
to any future snapshot format without touching the metadata store at all, since the two
are already decoupled.
