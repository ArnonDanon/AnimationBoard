# AnimationBoard — Domain Model & Bounded Contexts

Status: Draft, pending sign-off
Builds on: `docs/00-requirements.md`

## Modeling Principles

- Solo-dev, POC-scoped: fewer bounded contexts than an enterprise design would use.
  Contexts are only split where they have genuinely different rates of change,
  different consistency needs, or are meant to be independently replaceable/extractable
  later (e.g. into a marketplace service). Splitting further than that is speculative
  and will just mean more code for one person to wire together.
- Every context below is real POC scope except where marked **(future-only)** — those
  are named now so later work has a home, but nothing is built for them yet.

---

## Bounded Context Map

```
┌────────────────┐        references AnimatorId       ┌─────────────────────┐
│  Identity       │ ─────────────────────────────────▶ │  Project             │
│  (Animator/Auth)│                                     │  (Project,           │
└────────────────┘                                     │   Membership/Share)  │
        ▲                                               └──────────┬──────────┘
        │ references AnimatorId                                    │ owns 1:1
        │                                                           ▼
┌────────────────────┐   snapshot-at-creation (no live ref) ┌────────────────────┐
│  Personal Library    │ ────────────────────────────────▶ │  Document            │
│  (Brush, Palette —   │                                    │  (Timeline, Frame,   │
│   owned by Animator) │                                    │   Layer, VectorObj)  │
└────────────────────┘                                    └──────────┬──────────┘
                                                                      │ mutated by
                                                                      ▼
                                                            ┌────────────────────┐
                                                            │  Realtime            │
                                                            │  Collaboration       │
                                                            │  (ephemeral session, │
                                                            │   sync of Document)  │
                                                            └────────────────────┘

Future-only, named for extension points, not built in POC:
  Marketplace • Studio/Team • fine-grained Authorization • Plugin • Commerce/Billing
```

**Why Project and Document are separate contexts, not one:** this is the single most
important boundary decision in the POC and will become the first ADR in the
architecture phase. Project metadata (name, owner, sharing) changes rarely and has
low write-contention. Document content (strokes, frames, layers) changes constantly
and is exactly what the realtime sync engine has to make concurrency-safe. Keeping
them separate means: (a) the sync/CRDT complexity is scoped to the Document context
only, not accidentally spread into project management; (b) a future Template or
Marketplace listing can publish a Document without dragging Project/ownership/sharing
concepts along with it — a template is "a Document with no Project wrapper yet."

**Why Personal Library (Brush/Palette) is separate from Document:** brush/palette
*ownership* belongs to the Animator (per FR-BRUSH-4), not the project — a brush must
be able to outlive any single project and be reused/sold across projects later. The
Document context only needs a resolved *snapshot* of a brush's style at the moment a
stroke is drawn (see [Cross-Context Integration](#cross-context-integration-decisions)),
not a live dependency on the brush library.

---

## Identity Context

Thin wrapper — the system of record for identity is the auth provider (see
architecture phase), not custom-built here.

**Animator** (Aggregate Root)
- `id`, `email`, `displayName`, `createdAt`
- Invariant: `id` is stable and is the reference key every other context uses
  (`AnimatorId`) — no other context stores a copy of email/displayName beyond what's
  needed for display (avoids sync-on-profile-edit problems later).

---

## Project Context

**Project** (Aggregate Root)
- `id`, `name`, `ownerId: AnimatorId`, `createdAt`, `updatedAt`, `documentId`
  (points to its 1:1 Document in the Document context)
- `members: ProjectMembership[]`
- Invariant: `members.length <= 3` for POC (owner + up to 2 collaborators) — a POC
  guardrail, not a permanent domain rule; future versions raise or remove this cap.
- Invariant: only the owner may rename, delete, or manage sharing on a Project. Any
  member (owner or collaborator) may edit the Project's Document content — matches
  FR-PROJ-6/FR-COLLAB ("no role distinctions required for editing").

**ProjectMembership** (Entity, part of the Project aggregate)
- `animatorId`, `role: owner | collaborator`, `invitedAt`
- POC has exactly two roles and no permission matrix — this is deliberately binary.
  A future **Authorization Context (future-only)** replaces `role` with granular
  permissions (Owner/Admin/Editor/Viewer, copyright/asset-ownership) without needing
  to change where membership data lives, only how it's interpreted.

---

## Document Context

The creative payload — this is the domain the Drawing Engine operates on, and the
part of the system realtime sync must keep consistent.

**Document** (Aggregate Root)
- `id`, `timeline: Timeline`
- In POC, exactly one Document per Project (`Project.documentId`), but modeled as its
  own aggregate/context so a future Template or Marketplace listing can be "a Document
  with no owning Project" without restructuring this model.

**Timeline** (Entity, inside Document)
- `frames: Frame[]` (ordered), `fps`
- Invariant: always has at least one Frame.

**Frame** (Entity)
- `id`, `name`, `order`, `layers: Layer[]` (ordered)
- Invariant: always has at least one Layer (the default layer, per FR-LAYER-1).

**Layer** (Entity)
- `id`, `name`, `order`, `visible: bool`, `locked: bool`, `objects: VectorObject[]`
- Invariant: if `locked || !visible`, no object under this layer can be mutated
  (matches FR-LAYER-4 exactly as written in requirements).
- Invariant: an operation scoped to one Layer never mutates another Layer's objects
  (FR-LAYER-5) — this is an engine implementation guarantee, not just a UI rule.

**VectorObject** (Entity — base shape for what a Layer contains)
- `id`, `kind: "stroke"` (POC only emits strokes; `"shape" | "text"` are future kinds
  the same base type already accommodates)
- `geometry`: path data (point/segment list — exact structure is an architecture-phase
  decision tied to the rendering approach ADR)
- `style`: resolved color, width (or width-per-point profile for pressure), opacity
- `transform`: position/scale/rotation, for FR-ENGINE-3 select/move/scale/rotate
- `createdBy: AnimatorId` — kept for future attribution/permissions, unused by any POC
  feature today

**Point** (Value Object, inside a stroke's geometry)
- `x`, `y`, `pressure` (0–1 raw value from Pointer Events), optional `timestamp`
- This is the *raw* captured pressure sample. Turning raw pressure into rendered
  width/opacity is the Brush's pressure-response behavior, applied at stroke-creation
  time (see below) — Point itself carries no brush logic.

**Domain services in this context (behavior, not persisted entities):**
- **EraserService**: takes an eraser stroke + the VectorObjects it overlaps, and
  performs geometry subtraction — splitting/trimming affected objects rather than
  deleting them (FR-ERASE-1). This is the "real eraser" logic.
- **ColorSampler**: given a point and the currently visible Layers in the current
  Frame, returns the Color of whatever's under that point (FR-COLOR-1). Read-only —
  does not mutate the Document.

---

## Personal Library Context

**Brush** (Entity)
- `id`, `ownerId: AnimatorId | null` (`null` = built-in/system brush, available to
  everyone — this is how the 2–3 POC brushes are modeled without inventing a separate
  "system brush" type)
- `name`, `shape`, `baseWidth`, `opacity`, `pressureSensitive: bool`,
  `pressureAffects: "width" | "opacity" | "both"`

**Palette** (Entity)
- `id`, `ownerId: AnimatorId | null` (`null` = built-in POC palette)
- `colors: Color[]`

Both entities model per-Animator ownership from day one per FR-BRUSH-4, even though
the POC only ever ships the built-in (`ownerId: null`) versions — this is the field
that lets brush import/purchase/marketplace attach later with no migration.

---

## Realtime Collaboration Context

**RealtimeSession** (ephemeral — not persisted the way Project/Document are)
- `projectId`, `participants: { animatorId, connectionId, cursor?, joinedAt }[]`
- Exists only while ≥1 client is connected to a given Project; reconstructed from
  connections, not read from a database. Presence/cursor data (FR-COLLAB-3) lives only
  here.
- The actual conflict-resolution mechanism for concurrent Document edits (FR-COLLAB-2)
  is *not* decided here — it's this context's core architecture-phase decision
  (CRDT vs. simpler per-object strategy), tracked as an open question already.

**Not part of the persisted domain model:** the client's current tool/brush/color
selection ("what am I about to draw with") is ephemeral UI/application state, scoped
to one user's editor session — it is not a domain entity and is never synced to other
collaborators as domain data (only the resulting strokes are).

---

## Cross-Context Integration Decisions

- **Brush styles are snapshotted, not live-referenced, into strokes.** When a stroke
  is created, the Document context copies the current resolved style (width, opacity,
  pressure behavior) from the Personal Library Brush into the `VectorObject.style` at
  creation time, rather than storing a `brushId` the renderer must resolve on every
  frame. Simplest implementation for POC; the tradeoff (editing a brush later won't
  retroactively restyle old strokes) matches how real drawing tools already behave, so
  it's not actually a compromise — it's correct behavior.
- **Project and Document share a lifecycle but not a data model.** Creating a Project
  creates exactly one Document in POC (enforced at the application layer, not a
  database foreign key requirement) — this is the simplest thing that still keeps the
  contexts genuinely separable later.

---

## Explicitly Not Modeled Yet (Future Contexts)

Named as extension points; no entities/tables/services built for these in the POC:

- **Marketplace context** — Listing, Purchase, published versions of Brush/Palette/
  Template/Document
- **Studio/Team context** — Studio, StudioMembership, Studio-owned Projects
- **Authorization context** — replaces `ProjectMembership.role` with a real
  permission matrix (Owner/Admin/Editor/Viewer), copyright/asset-ownership metadata
- **Plugin context** — third-party extensions to the Drawing Engine
- **Commerce/Billing context** — payments for marketplace purchases, subscriptions
- **Template context beyond "empty"** — publishing/importing reusable Documents as
  starting points

## Open Questions (carried into architecture phase)

- Exact shape of `VectorObject.geometry` (point/segment representation) — depends on
  the rendering-engine ADR.
- Whether `RealtimeSession` state lives in-memory on a single server process (fine at
  2–3 users) or needs an external store — depends on the deployment/hosting ADR.
- Whether Document versioning/history (beyond undo/redo, e.g. for future "revert
  project to yesterday") is needed even at POC scale — currently assumed **no**, undo/
  redo is per-session only and not persisted across reloads unless said otherwise.
