# RelayGuard architecture

## Repository baseline

The workspace initially contained only the engineering directive in `build.md`: no application source, dependency manifest, tests, deployment configuration, credentials, or Git repository was present. There was no existing behavior to preserve. This repository uses Node.js/TypeScript as a minimal initial foundation; the choice can be revisited before a user-facing application is added.

## Target shape

Keep one canonical repository and one shared authorization boundary. Organize by actual runtime needs rather than creating microservices prematurely:

```text
src/
  core/       domain, deterministic policy, approvals, lifecycle, audit
  adapters/   versioned protocol adapter contract and implementations
  api/        authenticated application/API boundary (not implemented)
  web/        operator and agent experience (not implemented)
docs/
  architecture/
  adapters/
  deployment/
  hackathons/
test/
```

Mezo, Solana x402, NEAR, and Bitcoin Lightning remain separate adapter implementations and configurations. Shared core code must not encode provider URLs, chain addresses, signing keys, or protocol-specific settlement assumptions. Each deployment should select and configure adapters from the same build rather than fork or copy the application.

## Authorization boundary implemented

`src/core/policy.ts` evaluates exact integer amounts using decimal strings and `bigint`; floating-point amounts are rejected. Policy evaluation is deny-by-default for malformed intent/policy, expired policy, mismatched agent/network/asset, unapproved recipient, and exceeded transaction or daily limits.

`src/core/authorization.ts` uses SQLite transactions (`BEGIN IMMEDIATE`) to coordinate authorization decisions and daily spend reservations across database connections. The configured SQLite file persists authorizations, idempotency keys, approval challenge hashes, and audit events across process restarts. Approval challenges are never stored in plaintext. The in-memory SQLite default is intended for isolated tests.

It provides a state machine:

```text
denied
awaiting_approval -> authorized -> submitted -> confirmed
       |                 |            |
       +-> denied        +-> failed   +-> failed
       +-> expired
       +-> cancelled
```

Approvals expire after ten minutes and are bound to the exact intent digest and full policy digest. Pending approvals, authorized requests, submitted requests, and confirmed payments reserve/count toward the daily cap; failed and cancelled requests release the reservation. Reusing an idempotency key for different intent data is rejected.

Audit entries form a SHA-256 hash chain and include intent digests rather than raw payment details. On startup, the chain is verified and the service refuses a database with inconsistent audit evidence. This detects tampering but is not independently tamper-proof against a database administrator who can rewrite the chain. Backups, access controls, encryption-at-rest, and external audit anchoring remain unimplemented.

## Adapter boundary

`src/adapters/contract.ts` defines contract version `1.0.0`, explicit per-adapter capabilities, configuration validation, preparation/execution/status/settlement methods, and a typed unsupported result. No concrete blockchain adapter has been implemented yet. An adapter must not advertise a capability or claim settlement without protocol-specific implementation and authoritative evidence.

## Implementation stages and acceptance gates

1. **Audit/architecture:** complete for the empty workspace; documented here.
2. **Shared core:** policy, idempotency, approval lifecycle, durable SQLite reservations, and hash-linked audit implemented and tested. API identities, tenant isolation, and production database operations remain open.
3. **Adapter framework:** versioned contract defined. Contract/conformance test harness and concrete adapters remain open.
4. **Adapters:** verify current official protocol/provider documentation and implement one genuine end-to-end adapter at a time. No live integration is claimed.
5. **Workflow/UI:** API, authenticated human approvals, operator experience, paid-resource delivery, and receipts remain open.
6. **Deployments:** no hosting target or secrets were present. Four deployment configurations, CI/CD jobs, health checks, smoke tests, and rollback procedures remain open.
7. **Hardening:** threat model, persistent-store concurrency/recovery, security testing, accessibility, and performance validation remain open.
8. **Hackathon packaging:** event rules and eligibility must be verified before submission content is finalized.

## Important decisions / non-goals

- Amounts use integer base units, never floating-point currency.
- Authorization and settlement are separate states.
- AI output is untrusted input and is never an approval authority.
- The current in-memory coordinator is a test/local foundation only. A production implementation needs database transactions or equivalent atomic compare-and-reserve semantics before accepting concurrent requests.
- Missing credentials are not a reason to fake a transaction; they block network execution, live verification, and deployment evidence only.
