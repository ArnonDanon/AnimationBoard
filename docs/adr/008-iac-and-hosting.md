# 008. Infrastructure-as-Code & Frontend Hosting

Status: Accepted

## Context

Even a solo-developer POC benefits from infra defined in code rather than clicked
together in the AWS console, to avoid undocumented drift and make the backend
reproducible. Separately, the static frontend needs a hosting/CI story.

## Alternatives Considered

IaC: **AWS CDK (TypeScript)** vs. **AWS SAM** vs. **Terraform** vs. manual console setup.
Frontend hosting: **AWS Amplify Hosting** vs. **S3 + CloudFront** wired by hand.

## Decision

AWS CDK (TypeScript) for backend infra; AWS Amplify Hosting for the frontend.

## Pros / Cons

**Chosen (CDK)**
- Pros: same language (TypeScript) as the rest of the codebase — one toolchain, one
  set of types, no context-switching to YAML/HCL for a solo developer. Good
  first-class support for the exact services this architecture uses (Lambda, API
  Gateway HTTP + WebSocket, DynamoDB, S3, Cognito).
- Cons: AWS-only (not portable to other clouds), which is a non-issue since this whole
  architecture is already AWS-native by requirement.

**Rejected (SAM)**: narrower focus on Lambda-centric serverless apps specifically;
CDK covers the same ground with a real programming language instead of templated YAML,
and this project already needs DynamoDB/S3/Cognito resources beyond just functions.

**Rejected (Terraform)**: strong multi-cloud tool, but that portability is unused value
here, and it's an extra HCL toolchain/state-backend concern for a solo developer versus
CDK's plain TypeScript.

**Rejected (manual console setup)**: fastest to start, but undocumented and
unreproducible — the first time something needs rebuilding (new environment, disaster
recovery), all context is lost.

**Chosen (Amplify Hosting)**
- Pros: git-push-to-deploy with built-in CI for a static SPA — minimal setup for a solo
  developer, pairs naturally with Cognito (same Amplify ecosystem) if the Amplify
  client libraries are used for auth.
- Cons: less granular control over caching/headers than hand-configured
  CloudFront — acceptable to trade away for POC velocity; revisit if that control is
  needed later.

## Long-Term Implications

Locks in: backend resources are CDK constructs — extending the system means adding
constructs, not hand-editing console state. Keeps open: swapping Amplify Hosting for a
hand-rolled S3+CloudFront setup later is a hosting-layer change only, independent of
every other decision in this document.
