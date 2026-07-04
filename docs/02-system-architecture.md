# AnimationBoard — System Architecture (POC)

Status: Draft, pending sign-off
Builds on: `docs/00-requirements.md`, `docs/01-domain-model.md`
Formal reasoning for each technology choice below lives in `docs/adr/` — this document
is the assembled picture; the ADRs are the record of *why*.

## 1. Guiding Constraint

Solo developer, POC used occasionally by 2–3 people, near-zero cost when idle, minimal
operational surface (nothing a solo dev has to patch, restart, or scale by hand). Every
choice below is biased toward fully-managed AWS services over anything self-hosted,
even where a self-hosted option would be marginally more "correct" at scale — that
scale isn't the POC's problem yet (NFR-COST-1, NFR-MAINT-2).

## 2. High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Chrome/Edge)                                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ React + TypeScript SPA                                   │  │
│  │  ┌─────────────────┐   ┌───────────────────────────┐   │  │
│  │  │ Drawing Engine    │   │ Yjs client doc (CRDT       │   │  │
│  │  │ (framework-agnostic,│◀──│ replica of the Document)   │   │  │
│  │  │  Canvas2D renderer)│   └───────────────────────────┘   │  │
│  │  └─────────────────┘                                     │  │
│  └───────────────────────────────────────────────────────┘  │
└───────────┬───────────────────────┬───────────────────┬───────┘
            │ Cognito SDK           │ HTTPS (REST)        │ WSS
            ▼                       ▼                     ▼
     ┌─────────────┐        ┌───────────────┐    ┌──────────────────┐
     │  Cognito      │        │ API Gateway    │    │ API Gateway        │
     │  User Pool    │        │ HTTP API       │    │ WebSocket API      │
     │  (auth)       │        │ + Lambda        │    │ + Lambda (relay)   │
     └─────────────┘        └───────┬───────┘    └─────────┬──────────┘
                                     │                        │
                     ┌───────────────┴───────────┐   ┌───────┴────────┐
                     ▼                            ▼   ▼                ▼
              ┌─────────────┐            ┌─────────────┐      ┌───────────────┐
              │  DynamoDB     │            │  S3           │      │  DynamoDB       │
              │  (Projects,   │            │  (Document    │      │  (WebSocket      │
              │  Membership)  │            │  snapshots)   │      │  connections)    │
              └─────────────┘            └─────────────┘      └───────────────┘
```

Frontend hosting (static assets) and CloudWatch (logs/alarms) are omitted from the
diagram for clarity — see [Deployment](#9-deployment--cicd) and
[Monitoring](#10-monitoring--logging) below.

## 3. Frontend Architecture

- **React + TypeScript** SPA (ADR-007).
- **Drawing Engine is a separate, framework-agnostic module** (per FR-ENGINE-6): plain
  TypeScript, no React import. It exposes an imperative API (`loadDocument`,
  `setActiveTool`, `undo/redo`, …) and emits events the UI listens to. A thin React
  component owns the `<canvas>` element, forwards Pointer Events into the engine, and
  re-renders React UI (toolbars, panels) in response to engine events — the canvas
  itself is painted directly by the engine's renderer, not by React.
- **State**: the Yjs `Y.Doc` (see ADR-003) *is* the source of truth for Document
  content — Timeline/Frame/Layer/VectorObject data lives in Yjs shared types, and the
  Drawing Engine reads/writes through it directly. React components subscribe to Yjs
  observers to re-render panels (layer list, frame list) when content changes.
  Non-collaborative, per-user UI state (active tool, active brush/color, open
  modals) stays in ordinary React state — it is never put in the shared Yjs doc.
- **Rendering**: Canvas2D, custom scene graph (ADR-002) — chosen specifically because
  pressure-variable-width strokes need a hand-built outline either way (neither SVG nor
  Canvas natively varies stroke width along one path), so Canvas2D's lighter weight per
  redraw wins over SVG DOM without losing anything stroke-rendering needs.

## 4. Backend Architecture

Fully serverless: **API Gateway (HTTP + WebSocket APIs) + Lambda (Node.js/TypeScript)
+ DynamoDB + S3**. No container or VM to patch, restart, or pay for while idle — this
is the architecture's biggest lever for "one person can operate this."

- **HTTP API + Lambda**: project CRUD (create/list/rename/delete), sharing/invite,
  document snapshot load/save, brush/palette config lookup.
- **WebSocket API + Lambda**: realtime relay only (see ADR-003/ADR-006) — Lambda does
  not merge CRDT state, it forwards binary Yjs update messages between the connections
  currently in the same project's "room," tracked via a small DynamoDB connections
  table (`connectionId → projectId, animatorId`).
- Every Lambda handler validates the caller's Cognito JWT and checks `ProjectMembership`
  (from `docs/01-domain-model.md`) before allowing access to a given project/document —
  this is the enforcement point for NFR-SEC-2.

## 5. Drawing Engine Architecture (summary — full design in Phase 5)

Subsystems, all inside the framework-agnostic engine module:

- **Input capture**: Pointer Events → a stream of `Point{x, y, pressure}` (per the
  domain model's Point value object).
- **Stroke builder**: consumes the Point stream plus the active Brush, producing a
  `VectorObject`'s geometry and style — this is where raw pressure becomes rendered
  width/opacity (FR-BRUSH-2).
- **Renderer**: Canvas2D, redraws the visible Layers of the current Frame on each
  change; structured so a future onion-skin overlay is "draw the previous Frame first,
  at reduced alpha" — a hook, not a redesign.
- **Hit-tester**: uses Canvas2D's `isPointInPath` against each object's path, avoiding
  hand-rolled geometric hit-testing.
- **Eraser**: the `EraserService` domain service (docs/01) — geometry subtraction
  against overlapping objects.
- **Undo/redo**: local command stack, per browser tab, not synced or persisted across
  reloads in the POC (see open question in domain model doc).
- **Serializer**: converts between the engine's in-memory model, the Yjs shared types,
  and the flat JSON/binary snapshot format persisted to S3.

## 6. Realtime Collaboration Architecture

Built in Epic 10; this section describes the actual implementation (superseding the
pre-build summary this section used to contain — see `docs/03-roadmap.md` Epic 10 for
the build history and the bug found during verification).

### 6.1 Wire protocol and message flow

1. **Connect**: the client opens `wss://.../poc?token=<CognitoIdToken>&projectId=<id>`.
   Browsers can't set custom headers on a WebSocket handshake, so both values travel as
   query-string parameters instead of an `Authorization` header.
2. **Authorization** (`infra/lambda/ws/authorizer.ts`): a Lambda **REQUEST** authorizer
   (the only authorizer type WebSocket APIs support — there's no WebSocket equivalent of
   the HTTP API's built-in Cognito User Pool authorizer) verifies the ID token via
   `aws-jwt-verify`, then checks `ProjectMembersTable` for a membership row. Allow
   returns an IAM policy plus `{ animatorId, projectId }` in the authorizer context;
   Deny rejects the handshake outright — a non-member never reaches `$connect`.
3. **Connect handler** (`connect.ts`) trusts that context and writes one row to
   `ConnectionsTable`: `{ connectionId, projectId, animatorId, ttl }`. The `ttl`
   (now + 24h) is a safety net for connections that drop without a clean
   `$disconnect` (network blip, tab killed) — DynamoDB TTL eventually reaps them even
   if nothing else does.
4. **Sending an edit**: the client's `RealtimeProvider` (`packages/drawing-engine/src/realtime.ts`)
   listens for `doc.on('update', ...)`. Every local edit — a stroke, an erase, adding a
   frame, reordering a layer, all of it — produces a small Yjs binary update, which gets
   base64-encoded into `{ type: 'update', update: '<base64>' }` and sent as a WebSocket
   **text frame** (JSON, not binary — sidesteps API Gateway's binary-frame handling
   entirely, matching the base64-in-JSON convention the HTTP snapshot save/load already
   uses).
5. **Relay** (`default.ts`) is a **pure fan-out, per ADR-006** — it never inspects or
   merges the Yjs payload. It looks up the sender's `projectId` from `ConnectionsTable`
   (by `connectionId`), queries the `byProject` GSI for every other connection on that
   project, and `PostToConnectionCommand`s the identical bytes to each one. A
   `GoneException` (recipient's socket is dead) deletes that stale row and moves on —
   it doesn't fail the whole relay.
6. **Receiving an edit**: the recipient's `RealtimeProvider` applies the bytes via
   `Y.applyUpdate(doc, bytes, this)` — passing the provider instance itself as the Yjs
   transaction **origin**. This one line does two jobs at once:
   - `doc.on('update', ...)` on the receiving provider checks `origin === this` and
     skips re-sending — without this, the update would bounce back out to the relay and
     everyone would echo each other's edits forever.
   - `Y.UndoManager` (`packages/drawing-engine/src/history.ts`) only tracks
     transactions whose origin is `null` (its default `trackedOrigins`). A remote
     update's origin is the provider instance, never `null`, so it's automatically
     invisible to the undo stack — you can never accidentally Ctrl+Z a collaborator's
     edit. This came free from Yjs's own design; nothing extra was written for it.
7. **Reconnect**: on an unexpected close, the provider retries with capped exponential
   backoff (starts at 1s, doubles, caps at 15s). Edits made while disconnected or still
   mid-handshake are queued client-side and flushed once the socket reopens — see the
   bug note in `docs/03-roadmap.md` Epic 10 for why this queue exists (without it, the
   very first edit after opening a freshly-shared project could be silently dropped
   from the realtime channel during the authorizer's cold start).
8. **Persistence stays independent of all this** (Epic 9, unchanged by Epic 10): each
   client still autosaves its local `Y.Doc` to S3 via the HTTP API on its own debounce
   timer, regardless of realtime connectivity. The realtime channel only carries
   *incremental* updates from the moment a client connects onward — it is not the
   source of truth and was never meant to replay history; a freshly-opened client
   always starts from the last saved HTTP snapshot (Epic 9), then layers live updates
   on top. This is why the relay Lambda can be, and is, completely stateless.

### 6.2 What's shared vs. what's per-viewer local state

The single most important thing to understand: **the whole `Y.Doc` syncs — every
frame, every layer, every object — regardless of which frame or layer any given user
happens to be looking at.** There is no concept of "only sync the frame someone's
currently on." Concretely:

| State | Shared (in the `Y.Doc`) | Local to each browser tab |
|---|---|---|
| Frames, layers, vector objects (strokes) | ✅ all of it, always | |
| Frame/layer add, delete, rename, reorder, visibility, lock | ✅ | |
| Timeline FPS | ✅ | |
| Which frame/layer you're currently *viewing* (`activeFrameIndex`/`activeLayerIndex`) | | ✅ (`DrawingEngine` instance fields, never written to the doc) |
| Selection (which object is selected, drag state) | | ✅ |
| Active tool, active brush, brush size/opacity, active color | | ✅ (deliberately — see Epic 4 notes: personal tool preference, not project content) |
| Playback (`isPlaying`, the `setInterval` driving it) | | ✅ |

### 6.3 Concrete scenario: two users on different frames

Say Animator A is looking at Frame 1 and Animator B is looking at Frame 3 of the same
project, both connected.

- **B draws a stroke on Frame 3.** That edit is committed to the shared `Y.Doc`,
  broadcast over the WebSocket, and applied to A's local `Y.Doc` too — same as any
  other edit, because the relay doesn't know or care which frame it touched. **A's
  screen does not visibly change**, because A is rendering Frame 1, not Frame 3 — the
  new stroke is sitting in A's document already, just on a frame A isn't looking at. If
  A later clicks over to Frame 3, it's already there, fully formed, with no additional
  load or wait.
- **B adds a new Frame 4.** A's Timeline strip updates live to show it (the Timeline
  component re-reads `engine.getFrames()` on every doc change, remote or local) — A
  sees a new frame card appear without doing anything, but A's own `activeFrameIndex`
  does not jump to it; A stays exactly where they were.
- **A deletes a layer on Frame 1 while B is also looking at Frame 1.** B's LayerPanel
  updates live. If B's `activeLayerIndex` pointed at a layer that shifted position (or
  was the one deleted), it's clamped back into valid bounds automatically — B won't
  crash or draw into a nonexistent layer, but which layer becomes newly "active" for B
  isn't something B explicitly chose. Worth knowing if it ever surfaces as a confusing
  "wait, why am I drawing on this layer" report.
- **A hits Play.** Only A's view advances through frames on a timer. B's view is
  completely unaffected — playback is local UI state, never written to the doc, so
  there's no "someone started playing the animation" signal sent to anyone.
- **Undo**: A's Ctrl+Z only ever undoes A's own most recent local edit (origin `null`,
  scoped to the whole frames tree, not just the frame A is viewing) — it can't undo
  something B did, on any frame, ever.

### 6.4 Gaps vs. a Canva-like experience (deliberately deferred, not overlooked)

What's described above is real-time *document* sync — genuinely solid, verified live
with two independent Cognito sessions (Epic 10). What it does **not** yet have, and
what Canva-style tools are usually judged on, is *presence*: any signal about what your
collaborators are doing right now.

- No cursor/pointer indicator showing where a collaborator's mouse is.
- No "Animator B is on Frame 3" badge — you can't tell, from the UI, that someone else
  is even in the project with you, let alone where they're looking.
- No avatar list of who's currently connected.
- No live "someone is drawing right now" stroke-in-progress preview — you only see a
  collaborator's stroke once they finish it and it commits to the doc (their in-progress
  drag is local-only, same as your own — see `commitStroke` in `engine.ts`).

This is exactly **FR-COLLAB-3**, and it was explicitly scoped out of Epic 10 per the
roadmap's own instruction ("skip first if short on time, core requirement is
FR-COLLAB-1/2 not FR-COLLAB-3"). The good news: the mechanism to add it is already
half-built by construction. Yjs ships an **Awareness** protocol specifically for this
(ephemeral, non-document state like cursor position and "who's online" — it rides the
same connection as document updates, doesn't touch the CRDT document itself, and isn't
persisted). Adding it later would mean: broadcasting small Awareness payloads through
the *same* relay Lambda (already a generic byte-fanout, would need no changes), and a
new client-side layer that publishes local cursor position / active-frame index as
Awareness state and renders other clients' Awareness state as UI (cursor dots, a "B is
on Frame 3" indicator, an avatar strip). None of the current architecture blocks this —
it's additive work, not a rearchitecture, precisely because ADR-003 chose Yjs partly
*for* this reason.

### 6.5 Failure modes worth knowing

- **A non-member's token is rejected at `$connect`** — the authorizer denies before the
  connect handler ever runs, so there's no connection row, no relay eligibility, nothing
  to clean up.
- **A stale/disconnected collaborator doesn't block anyone.** The relay deletes a dead
  connection's row reactively (on the next `GoneException`), not proactively — so there
  can be a brief window (until the next message happens to target that dead connection)
  where a departed collaborator still "counts" as a sibling in the `byProject` query,
  but this never blocks or slows down delivery to the connections that *are* alive; it
  only costs one extra failed `PostToConnectionCommand` call, caught and cleaned up
  inline.
- **Everything degrades to single-user mode gracefully.** If the WebSocket can't
  connect at all (network down, backend issue), the editor still works — drawing,
  undo, layers, frames, all of it — because none of that logic depends on the realtime
  layer being present. You just don't see anyone else's edits until the connection
  recovers (autosave to S3 via the HTTP path still works independently). This was true
  by construction, not by explicit design for this failure case — the `RealtimeProvider`
  is purely additive to a `Y.Doc` that already worked standalone since Epic 3.

## 7. Storage / Data Architecture

- **DynamoDB** — `Projects` and `ProjectMembership` (from docs/01): low volume, simple
  access patterns (get-by-id, list-by-owner, list-by-member), well within free tier at
  POC scale.
- **S3** — Document snapshots (binary Yjs state), one object per `documentId`, with
  S3 versioning enabled — this is a free-with-the-bucket safety net (recover a
  previous snapshot version) even though full document history isn't a stated
  requirement (NFR-DATA-1/2).
- **Built-in Brushes/Palettes**: for the POC these are **static config bundled with the
  frontend build**, not database rows — there is no user-created brush yet (`ownerId:
  null` per the domain model), so a DB table would be pure overhead until brush
  import/purchase actually exists.

## 8. Authentication & Authorization

- **AWS Cognito User Pool** handles registration, login, password reset, and issues
  JWTs — the frontend talks to Cognito directly (via Amplify Auth or
  `amazon-cognito-identity-js`); no credentials ever touch AnimationBoard's own backend
  (NFR-SEC-1).
- **Authorization** is `ProjectMembership`-based, checked in every Lambda handler (HTTP
  and WebSocket `$connect`): does this JWT's Animator ID belong to this Project? POC
  has exactly the two roles from the domain model (owner/collaborator) — no permission
  matrix yet.

## 9. Deployment & CI/CD

- **Infra as code**: AWS CDK (TypeScript) — same language as the app, one toolchain for
  a solo developer to hold in their head.
- **Frontend hosting**: AWS Amplify Hosting (git-push-to-deploy, built-in CI) —
  recommended over hand-wiring S3+CloudFront for POC velocity; revisit if more control
  over caching/headers is needed later.
- **Backend**: CDK-deployed Lambda + API Gateway + DynamoDB + S3.
- **CI**: GitHub Actions (or Amplify's built-in CI) running typecheck + tests before
  each deploy.

## 10. Monitoring & Logging

- **CloudWatch Logs** (automatic for every Lambda invocation) + a **CloudWatch Alarm**
  on Lambda error rate / API Gateway 5xx rate, wired to an **SNS email** — satisfies
  NFR-OBS-1 ("not flying fully blind") with zero new vendors.
- **Frontend errors**: a small `window.onerror`/`unhandledrejection` handler POSTs to a
  lightweight logging Lambda → CloudWatch Logs. A dedicated error-tracking vendor
  (Sentry, etc.) is deferred until error volume or team size justifies it.

## 11. Technology Choices Summary

| Concern | POC Choice | ADR |
|---|---|---|
| Frontend framework | React + TypeScript | ADR-007 |
| Vector rendering | Canvas2D custom scene graph | ADR-002 |
| Realtime sync | Yjs (CRDT) | ADR-003 |
| Realtime transport/hosting | API Gateway WebSocket + Lambda (serverless relay) | ADR-006 |
| Metadata storage | DynamoDB | ADR-004 |
| Document storage | S3 (Yjs snapshot blobs) | ADR-004 |
| Authentication | AWS Cognito | ADR-005 |
| Bounded context split | Project ≠ Document | ADR-001 |
| IaC / hosting | AWS CDK + Amplify Hosting | ADR-008 |

## 12. What This Architecture Explicitly Defers

Multi-region deployment, autoscaling tuning, WAF/rate-limiting hardening, CDN cache
tuning, a dedicated observability stack (Sentry/Datadog/etc.), Studio/Marketplace
backend services, >3 concurrent collaborators per document, offline-first editing with
reconciliation. None of these are precluded by the choices above — they're additive.

## 13. Open Questions Carried Forward (into Phase 5 detailed designs)

All resolved by the actual build (Epics 1–10); kept here for history rather than
deleted, since the roadmap/ADR docs are where the reasoning behind each answer lives:

- ~~Exact DynamoDB table/key design for Projects + Membership + Connections.~~ — see
  `infra/lib/data-stack.ts`; `ConnectionsTable` also gained a `byAnimator` GSI in
  Epic 10, ahead of actually needing it (see the code comment there for why).
- ~~Exact HTTP API route list and request/response shapes.~~ — `infra/lambda/http/handler.ts`.
- ~~Exact Yjs shared-type mapping for Timeline/Frame/Layer/VectorObject.~~ —
  `packages/drawing-engine/src/document.ts`.
- ~~Snapshot debounce interval and conflict window numbers.~~ — 2.5s autosave debounce
  (`apps/web/src/editor/Editor.tsx`); realtime sync (§6) makes the "conflict window"
  question largely moot for connected clients, since edits propagate live rather than
  only at snapshot time — the debounce now only matters for the last-edit-before-close
  data-loss window (NFR-DATA-1), not for merge correctness.
