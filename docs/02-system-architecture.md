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

## 6. Realtime Collaboration Architecture (summary — full design in Phase 5)

- Each connected client holds a full **Yjs `Y.Doc` replica**. Edits are applied locally
  first (instant local feedback, satisfies NFR-PERF-1 regardless of network latency),
  then Yjs produces a small binary update, sent over the WebSocket to the Lambda relay,
  which fans it out to other connections in the same project room. Every client merges
  incoming updates via Yjs — **no server-side merge logic to write or get wrong**
  (this is the main reason Yjs was chosen over a hand-rolled OT/locking scheme; see
  ADR-003).
- **Presence/cursors** (FR-COLLAB-3, stretch): Yjs's Awareness protocol, riding the same
  WebSocket channel — no separate infrastructure.
- **Persistence**: periodically (debounced after edits stop, and on clean disconnect)
  the client encodes the current Yjs doc state and POSTs it to the HTTP API, which
  writes it to S3 keyed by `documentId`. Opening a project fetches this snapshot and
  hydrates a fresh `Y.Doc` from it. This keeps the WebSocket relay itself stateless and
  disposable — it holds no durable state, only in-flight messages.

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

- Exact DynamoDB table/key design for Projects + Membership + Connections.
- Exact HTTP API route list and request/response shapes.
- Exact Yjs shared-type mapping for Timeline/Frame/Layer/VectorObject (Y.Array vs.
  Y.Map nesting).
- Snapshot debounce interval and conflict window numbers (ties back to
  `docs/00-requirements.md` §6).
