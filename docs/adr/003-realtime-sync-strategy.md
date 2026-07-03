# 003. Realtime Synchronization Strategy

Status: Accepted

## Context

2–3 collaborators may edit the same Document concurrently. Concurrent edits to
different objects/layers must not silently destroy each other's work (FR-COLLAB-2),
and this needs to be buildable and maintainable by a solo developer.

## Alternatives Considered

- **Custom Operational Transform (OT)**: the classic Google-Docs-era approach.
  Powerful but notoriously hard to implement correctly — subtle bugs only show up
  under real concurrent load.
- **CRDT via Yjs**: a mature, widely-used library purpose-built for exactly this
  problem — structured shared types (maps, arrays) that merge deterministically
  without a central authority resolving conflicts.
- **Simple last-writer-wins (LWW) with per-object granularity**: whichever edit to a
  given object arrives last at the server wins; no library dependency.

## Decision

Yjs (CRDT).

## Pros / Cons

**Chosen (Yjs)**
- Pros: merge logic is the library's problem, not ours — a solo developer does not
  have to get distributed-systems edge cases right by hand. Its `Y.Array`/`Y.Map`
  types map naturally onto the Document model's ordered Frames/Layers/objects,
  including concurrent insert/reorder, which plain LWW handles poorly. Comes with an
  Awareness protocol for free, covering the FR-COLLAB-3 presence/cursor stretch goal.
  Battle-tested in production collaborative editors.
- Cons: an external dependency whose internal update format we don't control; some
  learning curve for its API and shared-type model.

**Rejected (custom OT)**
- Pros: no dependency, full control.
- Cons: high risk of subtle correctness bugs for a solo developer to discover and fix
  alone; disproportionate effort relative to POC scope.

**Rejected (simple LWW)**
- Pros: trivial to implement, no dependency.
- Cons: handles concurrent edits to the *same* object by clobbering one side — exactly
  what FR-COLLAB-2 rules out — and handles concurrent structural changes (reordering
  frames/layers) even worse than object-level edits.

## Long-Term Implications

Locks in: the Document's in-memory representation is shaped by Yjs's shared types,
and the wire format for realtime updates is Yjs's binary update protocol. Both are
swappable later only via a migration (export from Yjs, import into a replacement) —
this is a genuinely hard-to-reverse decision, called out explicitly in the roadmap
phase. Keeps open: scaling collaborator count beyond 2–3 later mostly becomes a
transport/relay scaling question (ADR-006), not a re-architecture of how conflicts are
resolved.
