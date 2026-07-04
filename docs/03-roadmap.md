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

**Added after Epic 7** (user request, before moving to Epic 8): adjustable
size and opacity sliders for the active brush, in the toolbar. `setBrushSize`/
`setBrushOpacity` in `engine.ts` replace `this.activeBrush` wholesale via
spread rather than mutating a field in place — needed since `BUILT_IN_BRUSHES`
is a single shared array reused by every engine instance, so an in-place
mutation would leak into the preset for the rest of the session. Verified
live: default Pencil is thin/opaque, dragging Size to 20 visibly thickens
new strokes, dragging Opacity to 30% produces the correct alpha (measured).

**Follow-up** (same session): switched from "reset to preset defaults on
brush switch" to "remember each brush's last-used size/opacity for the rest
of the session," per explicit request — a `Map<brushId, {baseWidth, opacity}>`
on the engine, consulted in `setActiveBrush` and updated by the size/opacity
setters. In-memory only (a personal tool preference, not project content —
not written to the Yjs document, resets on reload). Verified live: set
Pencil to size 18/opacity 40%, Marker to size 25/opacity 60%, left Ink Brush
untouched — switching among all three repeatedly correctly preserved each
one's own values independently, including re-adjusting an already-overridden
brush.

## Epic 5 — Eraser

Goal: FR-ERASE-1..3.

- [x] `EraserService`: geometry subtraction against overlapping VectorObjects
      (splits/trims paths rather than deleting whole objects) — `eraser.ts`,
      9 unit tests (miss/full-cover/middle-split/end-trim/transform-baking/
      width-slicing, plus layer-scoped integration tests). Verified live: a
      stroke split down the middle leaves ink on both sides of the gap, not
      just a trimmed end — confirming actual splitting, not just deletion
- [x] At least one adjustable eraser size — range slider in the toolbar,
      `setEraserRadius`/`getEraserRadius`
- [x] Smoke-test responsiveness at normal drawing speed — ~1.8ms per erase
      event across 5 strokes (60fps budget is ~16ms/event), confirmed live

**Two things found and fixed during verification, neither in the erase logic
itself:**
- A stress test (25 overlapping translucent strokes, rapid scrub-erase) took
  ~1.7s — traced to full-canvas offscreen-layer allocation per translucent
  object per render. Fixed by reusing a single scratch canvas instead of
  allocating one per object per frame, and by giving uniform-width strokes
  (e.g. Marker) a fast single-stroke path that was never actually necessary
  to route through the offscreen-compositing logic at all. At realistic POC
  scale this is back to ~1.8ms/event; erasing across many dozens of
  overlapping translucent objects at once remains a known scaling limit, not
  worth solving now (dirty-rectangle/incremental rendering would fix it, but
  is real engineering effort disproportionate to POC scope).
- Confirmed Chromium's pointer input isn't perfectly uniform even for a
  "constant-pressure" mouse drag: the very first `pointermove` after
  `pointerdown` reports `pressure: 0`, then jumps to `0.5` for the rest of
  the gesture. Harmless (it's genuinely a slightly different sample, and the
  engine already handles pressure per point correctly) but worth knowing if
  a future bug report says "the very start of every mouse stroke looks a bit
  thin."

**Follow-up fixes from real usage feedback** (dense scribbles not reliably
erasing at minimum size):
- **Real bug in the erase geometry**: `isErased` only tested each stroke's
  discrete sample *points* against the eraser path, never the *segments*
  between them. A fast/coarse stroke has widely-spaced points, so the eraser
  could visually cross the rendered line between two points without being
  close enough to either point to register. Fixed with proper segment-to-path
  distance testing (including a real segment-intersection check). 9 new/
  updated unit tests, including one that reproduces the exact gap-cross
  scenario.
- **Deeper root cause of the reported symptom, unrelated to erasing at all**:
  the Brush tool's `pointerdown` hit-tested existing objects before deciding
  to draw, so starting a new stroke close to an existing one (exactly what a
  dense scribble does) would silently select-and-drag that existing stroke
  instead of drawing a new one — corrupting the scribble one stroke at a time
  while it was still being drawn, before the eraser was ever involved. Fixed
  by splitting selection into its own explicit **Select** tool (alongside
  Brush/Eraser); the Brush tool now always draws, never hit-tests. Confirmed
  live: 10 closely-packed lines now draw independently and the eraser at
  minimum size correctly touches every one of them.
- Added on-canvas eraser cursor feedback per request: a thin crosshair at the
  exact hot-point plus a translucent "heat zone" disc showing the effective
  radius, scaling live with the size slider — shown on hover, not just while
  actively erasing (required extending pointer capture to track hover moves,
  separate from the drag-only moves used for drawing/erasing/dragging).

**Second follow-up** (the above still deleted "a lot more than expected,"
worst at minimum size — reported directly against the fix above): two
compounding precision problems, both now fixed in `eraser.ts`.
- **The half-width padding from the first fix was itself the over-erase
  bug.** For a minimum-size eraser (radius 4) touching a Marker stroke
  (width 10, half-width 5), the padding alone more than doubled the actual
  erase reach beyond the visible circle — worse for smaller radii and
  thicker brushes, exactly matching "smallest size is where it's easiest to
  see." Removed entirely in this pass: the erase radius became exact,
  matching the on-screen heat-zone circle with no bonus reach.
- **Erase granularity was bound to the target stroke's original sample
  spacing**, not to anything the user could see: touching any part of a
  segment erased both of its full endpoints, so a quickly-drawn stroke
  (sparse points, long segments) could lose far more per touch than a
  slowly-drawn one — the "sometimes correct, sometimes not" the report
  described. Fixed by locally subdividing only the segments near the eraser
  (bounded to a small fixed spacing that scales with the eraser radius,
  `radius / 3`) before testing, so precision no longer depends on how fast
  the original stroke happened to be drawn. Segments far from the eraser are
  left untouched at their original point count.

**Third follow-up**: removing the half-width padding above overcorrected —
reported as the eraser not clearing the full visible hot-zone on Marker/Ink
Brush, leaving a stubby rounded "sausage" of surviving ink inside the
circle. The padding wasn't wrong in principle (a real eraser removes ink
wherever it visually touches, not just at a stroke's mathematical
centerline) — it was only ever a problem *combined with* the unbounded
granularity bug above, which is now fixed. Reinstated the half-width
widening on top of the now-precise, bounded granularity: erasing a thick
stroke now clears its full rendered ink extent within the circle, while
still leaving everything well outside `radius + half-width` untouched.
Verified live on both Marker and Ink Brush, including at minimum eraser
size (the case that first exposed all three of these bugs).

**Known limitation, deliberately not fixed (user decision 2026-07-04):**
touching *any* part of a thick stroke's rendered width — even just grazing
the edge — deletes that whole centerline segment at its *full* width. There
is no partial-width shaving: a `VectorObject` is a centerline (point list)
plus a scalar width per point, not a filled shape, so there is no way to
represent "the top half of this ink is erased, the bottom half survives and
is now off-center from the original line." A true fix means storing strokes
as filled polygon outlines and doing real boolean subtraction (clip the
eraser's disc out of the fill shape) — a rearchitecture of `VectorObject`,
not a tunable in `eraser.ts`. Decided to leave this for the POC and revisit
post-POC if warranted, rather than take on that rearchitecture now.

**Noted for later, explicitly out of current scope:** an opacity-based
eraser mode (fades ink toward transparent rather than removing geometry —
useful for soft/blended erasing). User wants this as a future enhancement,
not part of the POC.

## Epic 6 — Layers

Goal: FR-LAYER-1..5.

- [x] Default layer per new frame — already in place since Epic 3
      (`createFrame` always seeds one layer)
- [x] Add / delete / duplicate / rename layer — `document.ts`
      (`deleteLayer` refuses to remove a frame's last layer; `duplicateLayer`
      deep-copies objects with fresh ids so it's a genuinely independent
      copy). 6 new unit tests
- [x] Reorder layers (stacking order) — `moveLayer` (clone-with-preserved-id
      + delete + reinsert, since Yjs shared types can't be relocated in
      place), exposed as `moveLayerUp`/`moveLayerDown` in the UI. Verified
      live via actual stacking order: drew overlapping strokes on two
      layers and confirmed the top color swaps after reordering
- [x] Hide/show, lock/unlock (blocks edits per FR-LAYER-4) — already
      enforced by `isLayerEditable` since Epic 3; now toggleable from the UI
- [x] Layer panel UI — `LayerPanel.tsx`: click a row to make it active
      (replacing the old hardcoded "always draw on the topmost layer"),
      inline rename (double-click), visibility/lock icon toggles, move up/
      down, duplicate, delete

Also replaced the Epic 3-era simplification where the engine always drew on
whichever layer happened to be topmost — there's now a real
`activeLayerIndex`, and adding or duplicating a layer makes the new one
active automatically (matches how most drawing tools behave). Verified the
full lifecycle live in one pass: add → draw → hide/show → lock (blocks
drawing) → unlock → rename → reorder → duplicate → delete down to the last
layer (delete button correctly disables at that point). Zero console errors
throughout.

## Epic 7 — Frames & Timeline

Goal: FR-TIME-1..4.

- [x] Timeline as ordered Frame list, fixed/configurable FPS — already an
      ordered `Y.Array` since Epic 3; `setFps`/`getFps` added to
      `document.ts` (default 12, rounds and floors at 1)
- [x] Add / delete / duplicate / rename / reorder frame — `document.ts`,
      mirroring Epic 6's layer functions exactly (`deleteFrame` refuses to
      remove the timeline's last frame, `duplicateFrame` deep-copies every
      layer and object with fresh ids, `moveFrame` uses the same
      clone+delete+reinsert pattern). 8 new unit tests
- [x] Playback: render frames in sequence at target FPS, start/stop —
      `play()`/`pause()`/`getIsPlaying()` in `engine.ts`, `setInterval`-driven;
      stops automatically at the last frame rather than looping (looping is
      an Epic 11 stretch goal, per `docs/00-requirements.md`). Manual frame
      navigation while playing stops playback first, so it can't fight the
      timer
- [x] Timeline UI (frame strip) — `Timeline.tsx` replaces the old ◀ Frame
      X/Y ▶ indicator: play/pause, FPS input, and a scrollable strip of
      frame cards (click to activate, inline rename, move earlier/later,
      duplicate, delete)

Verified live: drew a distinct mark on each of 3 frames, confirmed each
plays back in sequence at a deliberately slow, measurable FPS (2fps) and
that playback stops exactly at the last frame without looping or continuing
to advance afterward. Also verified add/rename/duplicate/reorder/delete
end-to-end, including the delete guard at one remaining frame. One
verification-script bug caught along the way (not an app bug): Playwright
auto-scrolls the page to click elements below the fold, and the Timeline
sits below a tall canvas — a stale cached canvas bounding box from before
that scroll made a later draw land ~220px off. Fixed by re-fetching the
bounding box immediately before every simulated draw.

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
