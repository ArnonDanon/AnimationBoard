# 005. Authentication Provider

Status: Accepted

## Context

Need registration, login, and password reset (FR-AUTH-1..4), with credentials never
handled directly by AnimationBoard's own backend (NFR-SEC-1).

## Alternatives Considered

- **AWS Cognito User Pools.**
- **Self-rolled auth** (e.g. Lambda + bcrypt + a DynamoDB users table + hand-issued
  JWTs).
- **Third-party auth-as-a-service** (Auth0, Clerk, Firebase Auth).

## Decision

AWS Cognito User Pools.

## Pros / Cons

**Chosen (Cognito)**
- Pros: fully managed — password storage, reset flows, JWT issuance are AWS's problem,
  not ours; integrates natively with API Gateway (JWT authorizers) and IAM, keeping the
  rest of the stack in one vendor a solo developer already has to know; free tier
  comfortably covers POC-scale user counts.
- Cons: Cognito's UI/UX customization and some auth flows (e.g. certain social-login
  edge cases) are more awkward than newer auth-as-a-service products; not needed for
  POC scope (email+password only).

**Rejected (self-rolled auth)**
- Pros: full control over every flow.
- Cons: password storage and reset-flow security are exactly the kind of thing a solo
  developer should not be maintaining by hand — high risk for no POC benefit.

**Rejected (Auth0/Clerk/Firebase Auth)**
- Pros: often smoother DX and UI components than Cognito.
- Cons: adds a non-AWS vendor and a second identity system to reconcile with
  API Gateway/IAM permissions; Cognito already satisfies every POC requirement while
  keeping the whole stack on one platform.

## Long-Term Implications

Locks in: `AnimatorId` in the domain model is a Cognito user identifier (`sub` claim).
Keeps open: adding MFA, social login, or SSO later are Cognito User Pool features, not
architecture changes; a future Authorization context (docs/01, future-only) layers a
permission matrix on top of Cognito identity without replacing it.
