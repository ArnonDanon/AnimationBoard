# Architecture Decision Records (ADR) — AnimationBoard

This log captures every architecturally-significant decision for AnimationBoard: the
alternatives considered, their tradeoffs, the recommendation, and why. It is the
project's technical blueprint and is meant to stay accurate as the system evolves —
when a decision is revisited, add a new ADR that supersedes the old one rather than
editing history.

Status: active — see index below. Current planning phase and scope:
`docs/00-requirements.md`.

## Format

Each decision gets its own file: `NNN-short-title.md`, numbered sequentially.

```markdown
# NNN. Title

Status: Proposed | Accepted | Superseded by NNN

## Context
What problem/force is driving this decision?

## Alternatives Considered
- Option A — summary
- Option B — summary
- Option C — summary

## Decision
Which option was chosen.

## Pros / Cons
Tradeoffs of the chosen option (and briefly, why the others were rejected).

## Long-Term Implications
What this locks in, what it keeps open, what it would cost to change later.
```

## Index

| # | Title | Status |
|---|---|---|
| 001 | [Project/Document bounded context split](001-project-document-context-split.md) | Accepted |
| 002 | [Vector rendering approach (Canvas2D)](002-vector-rendering-approach.md) | Accepted |
| 003 | [Realtime sync strategy (Yjs/CRDT)](003-realtime-sync-strategy.md) | Accepted |
| 004 | [Persistence & storage (DynamoDB + S3)](004-persistence-storage.md) | Accepted |
| 005 | [Authentication provider (Cognito)](005-authentication-provider.md) | Accepted |
| 006 | [Realtime transport & hosting (serverless relay)](006-realtime-transport-hosting.md) | Accepted |
| 007 | [Frontend framework (React + TypeScript)](007-frontend-framework.md) | Accepted |
| 008 | [IaC & frontend hosting (CDK + Amplify)](008-iac-and-hosting.md) | Accepted |
