# 006. Realtime Transport & Hosting Model

Status: Accepted

## Context

Yjs (ADR-003) needs a transport to relay binary updates between the 2–3 clients
editing the same Document. The relay does not need to understand or merge CRDT state —
clients merge locally — it only needs to forward messages to the right connections and
occasionally trigger a snapshot persist. The question is what runs that relay and
where it lives operationally.

## Alternatives Considered

- **Serverless relay**: API Gateway WebSocket API + Lambda (`$connect`/`$disconnect`/
  `$default` handlers), tracking active connections per project in a small DynamoDB
  table, fanning out messages via the API Gateway Management API.
- **Persistent relay server**: a small always-on Node.js process (the standard
  `y-websocket` reference server pattern) running on Fargate or a single EC2 instance,
  holding connections and relaying in-process.

## Decision

Serverless relay: API Gateway WebSocket API + Lambda + DynamoDB connections table.

## Pros / Cons

**Chosen (serverless relay)**
- Pros: no container/VM to patch, restart, or pay for while idle — true near-zero cost
  when nobody's editing, which matters for a POC used occasionally (NFR-COST-1,
  NFR-MAINT-2). This is a well-documented AWS pattern (the API Gateway WebSocket chat
  app tutorial is essentially this exact architecture), so it's not exotic for a solo
  developer to build and operate.
- Cons: slightly more handler code than a persistent server (Lambda holds no in-memory
  room state between invocations, so "who else is in this room" must be looked up from
  DynamoDB on every message rather than kept in a local variable); Lambda cold starts
  add a small amount of first-message latency, acceptable given 2–3 users and no hard
  real-time (sub-frame) latency requirement.

**Rejected (persistent relay server)**
- Pros: simpler mental model (in-memory room state, no connections table needed);
  matches the `y-websocket` reference implementation almost exactly, so less code to
  write from scratch.
- Cons: an always-on Fargate task or EC2 instance is a piece of infrastructure a solo
  developer now owns continuously — patches, restarts after failures, and a non-zero
  baseline cost even when idle, which conflicts with NFR-COST-1/NFR-MAINT-2 more than
  the serverless option's slightly higher per-message code complexity justifies.

## Long-Term Implications

Locks in: relay logic expressed as stateless Lambda handlers plus a DynamoDB
connections table, rather than in-process room state. Keeps open: if collaborator
count per document grows well beyond 2–3 and this pattern's per-message DynamoDB
lookups become a bottleneck, migrating to a persistent relay (or a managed pub/sub
service) is a transport-layer swap — it does not touch the Document model, Yjs usage,
or client code, since clients only know they're sending/receiving bytes over a
WebSocket.
