# 007. Frontend Framework

Status: Accepted

## Context

Need a UI framework for the SPA hosting the Drawing Engine, project management
screens, and collaboration UI. The Drawing Engine itself is framework-agnostic
(FR-ENGINE-6) regardless of this choice — this decision only affects the surrounding
UI shell.

## Alternatives Considered

- **React + TypeScript.**
- **Vue 3 + TypeScript.**
- **Svelte/SvelteKit.**

## Decision

React + TypeScript.

## Pros / Cons

**Chosen (React)**
- Pros: largest ecosystem for exactly the adjacent needs this project has —
  Yjs integration examples, canvas/pointer-event handling patterns, AWS Amplify's
  first-class React support, and the largest pool of examples/answers a solo developer
  can lean on when stuck. TypeScript support is mature and idiomatic.
- Cons: more boilerplate than Vue/Svelte for simple UI; re-render model requires care
  to avoid re-rendering the canvas subtree unnecessarily (mitigated by keeping the
  Drawing Engine's paint loop outside React's render cycle entirely, per
  `docs/02-system-architecture.md` §3).

**Rejected (Vue 3)**
- Pros: gentler learning curve, less boilerplate than React for equivalent UI.
- Cons: smaller ecosystem overlap with this project's specific needs (canvas-heavy
  apps, Yjs examples skew React-first); no material advantage here to offset that.

**Rejected (Svelte/SvelteKit)**
- Pros: smallest runtime, often the least code for a given UI.
- Cons: smallest ecosystem of the three for this project's niche (realtime
  canvas-based collaborative editors); more first-of-its-kind integration work for a
  solo developer to do alone.

## Long-Term Implications

Locks in: UI component code and state-management glue are React-specific. Keeps open:
because the Drawing Engine is a separate, framework-agnostic module by design
(FR-ENGINE-6, ADR-independent), a future framework migration would only touch the UI
shell, not the engine — this decision is comparatively cheap to reverse precisely
because of that earlier separation.
