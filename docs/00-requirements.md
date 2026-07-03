# AnimationBoard — POC Requirements

Status: Draft, pending sign-off
Scope: Proof of Concept only. See [Future Capabilities](#5-explicitly-out-of-scope-for-poc-future-work)
for everything deliberately deferred.

Context locked in during planning: solo developer, desktop-first (Chrome/Edge,
mouse/Wacom), no existing tech constraints, POC caps collaboration at 2–3 concurrent
users with no studio/permissions layer. Full context in `docs/adr/` once architecture
phase starts.

---

## 1. Scope Statement

The POC must prove that AnimationBoard can be a **vector-based**, **collaborative**,
**browser-based** 2D animation editor with a genuinely usable pressure-sensitive
drawing experience — without building any of the productization/business-layer features
(marketplace, studios, granular permissions, billing). Every POC decision must still be
compatible with those future features, even though none of them ship in the POC.

"Simplest implementation that works" governs every requirement below: where a
requirement could be satisfied by a managed AWS service or a well-maintained open-source
library instead of custom code, that is the default.

---

## 2. Functional Requirements

### 2.1 Authentication (FR-AUTH)

- **FR-AUTH-1**: A user can register with an email + password.
- **FR-AUTH-2**: A user can log in and log out.
- **FR-AUTH-3**: A user can reset a forgotten password.
- **FR-AUTH-4**: Sessions persist across browser reloads (no re-login every visit).
- Out of scope for POC: social login, MFA, org/SSO, granular roles.

### 2.2 Project Management (FR-PROJ)

- **FR-PROJ-1**: A logged-in user can create a new project (starts from a single empty
  template — no template picker needed).
- **FR-PROJ-2**: A user can see a list of their own projects (name, last modified,
  thumbnail — thumbnail may be a static placeholder in POC if generating one is costly).
- **FR-PROJ-3**: Opening a project loads its full state (timeline, frames, layers,
  vector objects) exactly as last saved.
- **FR-PROJ-4**: A project's state is saved durably — no data loss on browser crash/close
  beyond a small, bounded window (see NFR-DATA-1).
- **FR-PROJ-5**: A user can rename or delete their own project.
- **FR-PROJ-6**: A project can be shared with 1–2 other registered users via a simple
  mechanism (e.g. invite by email or shareable link) so they can co-edit. No role
  distinctions required in POC — any invited collaborator can edit.
- Out of scope for POC: studios, folders/organization, project templates beyond empty,
  ownership transfer, copyright/asset-ownership metadata.

### 2.3 Drawing Engine (FR-ENGINE)

- **FR-ENGINE-1**: All drawing operations produce **editable vector objects** (paths),
  not raster pixels, stored in the project's internal document model.
- **FR-ENGINE-2**: The engine processes Pointer Events (`pointerdown/move/up`) and reads
  `pressure` and `pointerType` from the browser's Pointer Events API.
- **FR-ENGINE-3**: Users can select one or more objects on the active layer and move,
  scale, or rotate them (basic transform, not necessarily a full handle/gizmo UI in POC).
- **FR-ENGINE-4**: Users can undo/redo their own drawing actions.
- **FR-ENGINE-5**: The engine can serialize the full document (all frames/layers/objects)
  to a JSON-compatible format and deserialize it back losslessly — this is the save/load
  format from FR-PROJ-3/4.
- **FR-ENGINE-6**: The engine is a standalone module with no compile-time dependency on
  the UI framework choice (framework calls into the engine, not vice versa) — this is a
  design constraint, not a user-facing feature, kept because it's cheap now and expensive
  to retrofit later.

### 2.4 Layers (FR-LAYER)

- **FR-LAYER-1**: Every new frame starts with one default layer.
- **FR-LAYER-2**: A user can add, delete, duplicate, and rename layers within a frame.
- **FR-LAYER-3**: A user can reorder layers (changes stacking/paint order).
- **FR-LAYER-4**: A user can hide/show and lock/unlock a layer; a locked or hidden layer
  cannot be edited.
- **FR-LAYER-5**: Editing one layer never mutates objects belonging to another layer.
- Out of scope for POC: mirror horizontally/vertically (explicitly called out as
  stretch — include only if time remains after core items).

### 2.5 Frames & Timeline (FR-TIME)

- **FR-TIME-1**: A project has one timeline: an ordered list of frames.
- **FR-TIME-2**: A user can add, delete, duplicate, rename, and reorder frames.
- **FR-TIME-3**: A user can play back the timeline as an animation at a fixed or
  configurable FPS, in-browser (no export required for POC).
- **FR-TIME-4**: Playback can be stopped/started; looping is a stretch goal.
- Out of scope for POC: onion skin (deferred, not a stretch goal), variable playback
  speed, scrubbing UI polish, video/GIF export.

### 2.6 Brushes (FR-BRUSH)

- **FR-BRUSH-1**: At least **two, ideally three**, built-in brushes are available.
- **FR-BRUSH-2**: **At least one brush is pressure-sensitive**: pointer pressure must
  dynamically affect stroke width and/or opacity while drawing.
- **FR-BRUSH-3**: A user can pick brush color from the built-in POC palette (fixed set of
  ~9 colors, no custom palette editor required).
- **FR-BRUSH-4**: Brush ownership model is per-Animator, not per-Project, from day one
  (even though the POC only ships built-in brushes) — this is a data-model constraint
  that costs nothing now and avoids a migration later when brush import/marketplace
  ships.
- Out of scope for POC: brush import imported/custom brush editor, marketplace, tilt/twist/
  barrel-button input (engine should not actively reject this data if the browser
  provides it, but no feature depends on it yet).

### 2.7 Color Picker (FR-COLOR)

- **FR-COLOR-1**: A user can sample a color from any visible object, on any layer, in
  the currently viewed frame, using an eyedropper-style tool.
- **FR-COLOR-2**: The sampled color immediately becomes the active brush color.
- Out of scope for POC: sampling across frames the user isn't currently viewing,
  palette marketplace, saving sampled colors into a custom palette (may fall out of the
  built-in palette UI for free, but isn't a separate requirement).

### 2.8 Eraser (FR-ERASE)

- **FR-ERASE-1**: The eraser subtracts geometry from existing vector strokes/shapes it
  touches, rather than deleting whole objects — the core "real eraser" requirement.
- **FR-ERASE-2**: The eraser supports at least one adjustable size; a second shape/size
  option is a stretch goal.
- **FR-ERASE-3**: Erasing feels smooth/responsive at typical drawing speed (see
  NFR-PERF-1).

### 2.9 Realtime Collaboration (FR-COLLAB)

- **FR-COLLAB-1**: 2–3 users can have the same project open concurrently and see each
  other's edits reflected without manual refresh.
- **FR-COLLAB-2**: Concurrent edits to different objects/layers do not silently destroy
  each other's work. (Conflict resolution strategy — CRDT vs. simpler locking — is an
  architecture-phase decision, not fixed here.)
- **FR-COLLAB-3**: Each collaborator's cursor/presence is visible to others (stretch goal
  if it threatens POC timeline — the no-data-loss guarantee in FR-COLLAB-2 is the hard
  requirement, live cursors are polish).
- Out of scope for POC: >3 concurrent users, granular per-object locking/permissions,
  offline-then-reconcile editing, chat (deferred, not a stretch goal).

### 2.10 Stretch Goals (include only if core items above are done)

In priority order if time remains: basic shape tools (rectangle/circle/square), second
eraser shape, layer mirroring, timeline looping. Onion skin and chat are explicitly
**deferred, not stretch** — see [Section 4](#4-explicitly-out-of-scope-for-poc-future-work).

---

## 3. Non-Functional Requirements

### Performance (NFR-PERF)

- **NFR-PERF-1**: Freehand drawing must feel responsive at interactive frame rates on a
  mid-range laptop — no visible lag between pointer movement and stroke rendering during
  normal sketching speed. (Concrete target, e.g. input-to-render latency budget, to be
  set numerically in the architecture phase once a rendering approach is chosen.)
- **NFR-PERF-2**: A project with a modest number of frames/layers/objects (POC-scale,
  not production-scale) loads in a few seconds, not tens of seconds.

### Data Durability (NFR-DATA)

- **NFR-DATA-1**: Work in progress is saved frequently enough (autosave and/or
  continuous sync) that a crash or accidental tab close loses no more than a small,
  bounded amount of recent work.
- **NFR-DATA-2**: Saved projects are stored with the durability characteristics of a
  managed AWS storage service (not a single local disk) — no custom replication logic
  to build/maintain.

### Usability (NFR-UX)

- **NFR-UX-1**: A new user can create a project and draw a pressure-sensitive stroke
  within their first minute in the app, with no onboarding flow required to explain it.
- **NFR-UX-2**: Drawing, layers, and timeline controls follow conventions from
  comparable tools (Photoshop/Krita/Excalidraw) where reasonable, so existing habits
  transfer.

### Maintainability & Extensibility (NFR-MAINT)

- **NFR-MAINT-1**: The drawing engine, document/data model, and sync layer are
  structured so that studios, permissions, marketplace, plugins, and additional brush
  types can be added later without rewriting the vector document model or the
  engine/UI boundary. This is the primary justification for every "design for future"
  note attached to POC requirements above.
- **NFR-MAINT-2**: As a solo-developer project, the architecture favors fewer moving
  parts (fewer services, less custom infra) over theoretical scalability the POC will
  never exercise — this deliberately trades some enterprise-readiness for one person's
  ability to build and operate it.

### Security (NFR-SEC)

- **NFR-SEC-1**: Passwords/credentials are never handled directly by the app's own
  backend — delegated to a managed identity provider.
- **NFR-SEC-2**: A user cannot read or write another user's project unless explicitly
  shared with them.
- **NFR-SEC-3**: All traffic (app + realtime sync) is encrypted in transit.

### Cost (NFR-COST)

- **NFR-COST-1**: At POC scale (single developer, handful of test users), monthly AWS
  spend should be near the free tier — no always-on expensive infrastructure (e.g. a
  dedicated always-on GPU instance) provisioned for a POC with 2–3 users.

### Browser / Device Support (NFR-DEVICE)

- **NFR-DEVICE-1**: POC target is desktop Chrome and Edge (Chromium-based), with mouse
  and Wacom-class USB/Bluetooth tablets via the Pointer Events API.
- **NFR-DEVICE-2**: Safari, iPad+Apple Pencil, and Android+stylus are explicitly out of
  POC scope; the input-handling layer should not hard-code Chromium-only assumptions
  where avoidable, but no testing/QA effort is spent on them yet.

### Observability (NFR-OBS)

- **NFR-OBS-1**: Basic error visibility (e.g. unhandled exceptions, failed saves) is
  captured somewhere a solo developer can see it — full dashboards/alerting are future
  work, but flying fully blind is not acceptable even at POC scale.

---

## 4. Explicitly Out of Scope for POC (Future Work)

Tracked so the architecture accounts for them without building them now:

- Marketplace (brushes, templates, palettes, plugins, paid assets)
- Studio / team management, granular roles (Owner/Admin/Editor/Viewer), copyright and
  asset-ownership metadata
- Plugin system
- Template import/export/publishing beyond the single empty template
- Brush import/custom brush authoring, palette marketplace
- Onion skin (any form — single or multiple past/future frames) — deferred
- Realtime chat between collaborators — deferred
- >3 concurrent collaborators, offline editing with reconciliation
- Tilt/twist/barrel-button brush behaviors
- Export (video/GIF/image sequence) beyond in-app playback
- Non-Chromium/mobile platform support

## 5. Assumptions

- "2–3 concurrent users" means the realtime layer must be correct for that count; it
  does not need to be load-tested or horizontally scaled for more.
- "Save/load" means server-persisted projects tied to the user's account, not merely
  local-storage/export-to-file (that's a weaker guarantee than FR-PROJ-4 implies for a
  collaborative product).
- No existing AWS account/org constraints — the architecture phase can pick services
  freely.
- Color picker is a gating requirement for POC "done"; shape tools are a stretch goal;
  chat and onion skin are deferred (not tracked as POC scope at all, core or stretch).

## 6. Open Questions (carried into architecture phase, not blocking this doc)

- Exact vector rendering approach (SVG DOM vs. Canvas2D custom scene graph vs.
  WebGL) — architecture phase, backed by an ADR.
- Exact realtime sync strategy (CRDT library vs. simple last-writer-wins with
  per-object granularity) — architecture phase, backed by an ADR.
- Project sharing mechanism specifics (invite-by-link token vs. email-based invite
  requiring the invitee to already have an account) — architecture phase.
- Autosave cadence / conflict window numeric targets for NFR-DATA-1 and NFR-PERF-1 —
  set once the rendering and sync approach are chosen.
