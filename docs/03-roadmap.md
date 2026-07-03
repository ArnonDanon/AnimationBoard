# AnimationBoard — POC Roadmap: Epics, Features, Tasks

Status: Draft, pending sign-off
Builds on: `docs/00-requirements.md`, `docs/01-domain-model.md`,
`docs/02-system-architecture.md`, `docs/adr/*`

Kept intentionally lean — this is a working build checklist for a solo-dev, short-timeline
POC, not a spec. Check items off as you go; re-open this doc rather than starting a new one.

## Sequencing Insight (read before starting Epic 3)

Yjs (ADR-003) was already chosen as the realtime sync engine. The safest build order
uses a **local `Y.Doc` as the document model from day one** — even before any
networking exists — instead of building a plain-object document model first and
converting to Yjs shared types later. Single-user mode is just "a `Y.Doc` with no
network peers"; multi-user mode later is "the same `Y.Doc` plus a WebSocket transport."
This avoids rewriting the whole engine's state layer partway through the POC.

## Recommended Build Order

1. Scaffolding & deploy pipeline
2. Auth
3. Drawing engine core (on local Y.Doc)
4. Brushes + pressure
5. Eraser
6. Layers
7. Frames & Timeline + playback
8. Color picker
9. Persistence (save/load)
10. Realtime multi-user sync
11. Stretch goals (only if time remains)

Engine-and-content epics (3–8) come before persistence and before networking on
purpose: get the hardest, most novel technical risk (pressure-sensitive vector
rendering) working and feeling good with a single user before adding save/load or
multi-user complexity on top of it.

---

## Epic 1 — Scaffolding & Deploy Pipeline

Goal: an empty app round-trips through the full deploy pipeline before any real
feature is built, so integration pain is never saved for the end.

- [x] Repo init, TypeScript project structure (frontend app + drawing-engine package
      + CDK infra, per `docs/02-system-architecture.md` §3–4)
- [x] CDK stack: Cognito User Pool, empty HTTP API + WebSocket API + Lambda stubs,
      DynamoDB tables, S3 bucket (see ADR-004, ADR-008) — deployed to eu-west-1
- [x] Amplify Hosting connected to repo, deploys on push — app `AnimationBoard`
      (id `d73qalc1csxug`), branch `main`, build spec in `amplify.yml`
- [x] "Hello world" React app deployed and reachable end to end — verified live at
      `main.d73qalc1csxug.amplifyapp.com`

## Epic 2 — Authentication

Goal: FR-AUTH-1..4.

- [x] Cognito User Pool configured (email+password, password reset flow) —
      `accountRecovery: EMAIL_ONLY` added to AuthStack
- [x] Register / login / logout screens — `apps/web/src/auth/AuthScreen.tsx`,
      wired via `aws-amplify/auth`
- [x] Password reset flow — request-code step verified end-to-end; the
      confirm-code step uses the same `confirmResetPassword` API verified via
      the symmetric `confirmSignUp` path (untestable further without real
      email inbox access)
- [x] Session persists across reload (Cognito token refresh wired up) —
      verified via headless browser: reload keeps the signed-in state

## Epic 3 — Drawing Engine Core

Goal: FR-ENGINE-1..6 — the foundation everything else builds on.

- [x] Document model defined as Yjs shared types (Timeline/Frame/Layer/VectorObject
      per `docs/01-domain-model.md`), instantiated as a local `Y.Doc` (no network yet)
      — `packages/drawing-engine/src/document.ts`, 8 unit tests passing
- [x] Pointer Events capture (`pointerdown/move/up`) → `Point{x,y,pressure}` stream
      — `input.ts`
- [x] Canvas2D renderer: paints current Frame's visible Layers (ADR-002) —
      `render.ts`
- [x] Basic stroke rendering (fixed width, no pressure yet) to validate the pipeline
      end to end: pointer → document → render — verified live: drawing renders,
      972px stroke confirmed via pixel-alpha check
- [x] Selection: hit-testing via `ctx.isPointInStroke` (the correct Canvas2D API
      for stroked paths, not `isPointInPath` which tests fill regions), select
      one object — `geometry.ts`. Multi-select deferred (not exercised by any
      POC requirement yet)
- [x] Transform: move (drag), scale/rotate (toolbar buttons, no gizmo — matches
      FR-ENGINE-3's "not necessarily a full handle/gizmo UI") — all verified live
- [x] Undo/redo — `Y.UndoManager` scoped to the frames tree, verified live
- [x] Serialize/deserialize the `Y.Doc` to/from a snapshot format (used later by
      Persistence epic) — `serialize.ts`, round-trip unit-tested now while the
      model is fresh, per this task's own instruction

## Epic 4 — Brushes & Pressure

Goal: FR-BRUSH-1..4.

- [x] Brush data structure (shape, width, opacity, pressure-sensitivity flag,
      pressure-affects width/opacity/both) — per Personal Library context in
      `docs/01-domain-model.md` — `types.ts` (`Brush`)
- [x] 2–3 built-in brushes as static config (no DB row — see ADR-004 rationale)
      — `brush.ts`: Pencil (width-sensitive), Marker (fixed), Ink Brush
      (width+opacity-sensitive)
- [x] Pressure → stroke width and/or opacity mapping for at least one brush —
      `resolvePointWidth`/`resolveStrokeOpacity`, unit-tested; width varies
      continuously per point, opacity varies per-stroke-average (Canvas2D has
      no per-vertex alpha in one fill — see code comment for why that's a
      reasonable POC scope cut, not a shortcut on the requirement)
- [x] Brush style snapshotted into `VectorObject.style` at stroke-creation time
      (not a live reference — see domain model's cross-context integration note)
      — `resolveStrokeStyle`, unit-tested that mutating the brush afterwards
      doesn't affect an already-created stroke
- [x] Brush + color selection UI (toolbar) — verified live: switching brush/color
      updates active state and affects newly drawn strokes
- [x] Built-in ~9-color palette (static config) — `palette.ts`, matches
      `docs/00-requirements.md`'s POC palette exactly

**Bug caught and fixed during verification** (not in the brush logic — in
compositing): stroking many overlapping round-capped segments directly with
`globalAlpha < 1` double-composites alpha at every overlap, so a translucent
multi-point stroke rendered visibly darker/blotchier than its actual opacity
(measured 250/255 instead of the correct 217/255 for 0.85 opacity). Fixed by
painting the stroke opaque to an offscreen layer first, then compositing that
layer once with the real opacity — reverified pixel-exact after the fix.

## Epic 5 — Eraser

Goal: FR-ERASE-1..3.

- [ ] `EraserService`: geometry subtraction against overlapping VectorObjects
      (splits/trims paths rather than deleting whole objects)
- [ ] At least one adjustable eraser size
- [ ] Smoke-test responsiveness at normal drawing speed

## Epic 6 — Layers

Goal: FR-LAYER-1..5.

- [ ] Default layer per new frame
- [ ] Add / delete / duplicate / rename layer
- [ ] Reorder layers (stacking order)
- [ ] Hide/show, lock/unlock (blocks edits per FR-LAYER-4)
- [ ] Layer panel UI

## Epic 7 — Frames & Timeline

Goal: FR-TIME-1..4.

- [ ] Timeline as ordered Frame list, fixed/configurable FPS
- [ ] Add / delete / duplicate / rename / reorder frame
- [ ] Playback: render frames in sequence at target FPS, start/stop
- [ ] Timeline UI (frame strip)

## Epic 8 — Color Picker

Goal: FR-COLOR-1..2.

- [ ] `ColorSampler`: sample color at a point across visible layers in current frame
- [ ] Eyedropper tool UI; sampled color becomes active brush color

## Epic 9 — Persistence (Save/Load)

Goal: FR-PROJ-1..6, NFR-DATA-1..2.

- [ ] DynamoDB: Project + ProjectMembership tables/access patterns (ADR-004)
- [ ] HTTP API + Lambda: create / list / rename / delete project
- [ ] HTTP API + Lambda: save Document snapshot to S3, load snapshot → hydrate `Y.Doc`
- [ ] Autosave/debounced save while editing (bounds data-loss window per NFR-DATA-1)
- [ ] Project list UI (own projects, shared projects)
- [ ] Sharing: invite 1–2 collaborators (link or email), enforced 3-member cap
      (per Project aggregate invariant in `docs/01-domain-model.md`)

## Epic 10 — Realtime Multi-User Sync

Goal: FR-COLLAB-1..3.

- [ ] WebSocket API + Lambda relay (`$connect`/`$disconnect`/`$default`), DynamoDB
      connections table (ADR-006)
- [ ] Client: attach Yjs WebSocket provider to the already-existing local `Y.Doc`
      (no document-model changes needed — this is purely a transport addition per the
      Sequencing Insight above)
- [ ] Authorization check on `$connect`: caller must be a ProjectMembership member
- [ ] Multi-tab / two-browser manual test: concurrent edits to different
      objects/layers don't clobber each other (FR-COLLAB-2)
- [ ] Presence/cursors via Yjs Awareness (stretch within this epic — skip first if
      short on time, core requirement is FR-COLLAB-1/2 not FR-COLLAB-3)

## Epic 11 — Stretch Goals (only if time remains, in this order)

- [ ] Basic shape tools (rectangle/circle/square)
- [ ] Second eraser shape/size option
- [ ] Layer mirroring (horizontal/vertical)
- [ ] Timeline looping

---

## Definition of "POC Done"

All checkboxes in Epics 1–10 checked. Epic 11 items are bonus, not gating — see
`docs/00-requirements.md` for the authoritative core-vs-stretch split.

## Decisions That Get Expensive to Change Later

Flagging so they're made deliberately now, not drifted into — full reasoning in the
linked ADRs:

- **Yjs as the document's data model, not just a sync add-on** (ADR-003) — swapping
  sync strategies later means migrating the shared-type model, not just the transport.
- **Canvas2D as the render target** (ADR-002) — scene graph is written against
  Canvas2D's mental model; a WebGL renderer later sits behind the same scene graph but
  is a real rewrite of the paint layer.
- **Project ≠ Document** (ADR-001) — cheap to keep, expensive to retrofit if merged
  now and split later.
