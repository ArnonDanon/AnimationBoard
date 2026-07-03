# 001. Separate Project and Document Bounded Contexts

Status: Accepted

## Context

The domain has both slow-changing business metadata (project name, owner, sharing) and
fast-changing, concurrency-sensitive creative content (timeline, frames, layers,
strokes). We need to decide whether these live in one aggregate/context or two, since
this shapes everything downstream: the realtime sync engine, the data model, and how
future Templates/Marketplace features attach.

## Alternatives Considered

- **Single "Project" aggregate** containing both metadata and full document content.
  Simple to start — one object to load/save.
- **Separate Project and Document contexts**, linked by `Project.documentId`, as
  described in `docs/01-domain-model.md`.

## Decision

Separate Project and Document contexts. A Project has exactly one Document in the POC,
enforced at the application layer.

## Pros / Cons

**Chosen (separate contexts)**
- Pros: realtime sync complexity (CRDT, conflict resolution) is scoped entirely to
  Document; Project metadata operations (rename, delete, share) stay simple CRUD with
  no CRDT involvement. A future Template or Marketplace listing can be "a Document with
  no Project wrapper" without restructuring. Matches the natural read/write pattern:
  Project metadata is read often, written rarely; Document content is written
  constantly during an editing session.
- Cons: one extra layer of indirection (`documentId` lookup) even in the POC, where
  it's always 1:1 and could look unnecessary at first glance.

**Rejected (single aggregate)**
- Pros: fewer moving parts to start.
- Cons: couples the CRDT/sync engineering effort to project-management CRUD; makes
  "publish this as a template" later require carving the document back out of a
  Project-shaped object, i.e. undoing this exact decision under more time pressure.

## Long-Term Implications

Locks in: Document as an independently-addressable, independently-persistable entity.
Keeps open: Templates, Marketplace-published Documents, and multi-Project-per-Document
scenarios (e.g. "duplicate this project" without duplicating a template's canonical
Document) all become straightforward extensions rather than migrations.
