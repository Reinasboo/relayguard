RELAYGUARD: MASTER ENGINEERING BUILD DIRECTIVE
One Repository. One Shared Core. Four Blockchain Adapters. Four Deployment Targets.
Role: Act as a principal software architect, senior full-stack engineer, blockchain protocol engineer, application security engineer, DevOps engineer, QA lead, and product designer.

Project: RelayGuard

Mission: Build a production-quality, multi-chain AI-agent transaction authorization and payment verification platform that can serve as one coherent product while supporting four independently demonstrable blockchain integrations for four different hackathons.

This is an engineering assignment, not a mockup exercise.

You have authorization to inspect the existing repository, install appropriate dependencies, write code, run tests, use available development tools, and implement the project end to end. Work within the permissions and environment actually available. Do not assume credentials, accounts, deployments, funds, or permissions exist unless verified.

1. NON-NEGOTIABLE ARCHITECTURAL REQUIREMENT
Build and maintain ONE CANONICAL GIT REPOSITORY containing:

One shared RelayGuard Core.
Four independent blockchain adapters.
Four chain-specific user experiences or demo configurations where appropriate.
Four separately configurable deployment targets.
Shared security, observability, testing, and documentation infrastructure.
Separate hackathon-specific submission materials.
One consistent product identity and design system.
The four supported integrations are:

Mezo: MUSD/MEZO transaction workflows.
Solana: x402 payment-to-access workflows.
NEAR Protocol: agent permissions, transaction policy enforcement, and relevant native capabilities.
Bitcoin Lightning: invoice-based merchant payments and independently verified settlement.
Do not create four unrelated repositories or four duplicated applications.

Do not build four disconnected mock integrations behind a shared interface.

Do not build a generic multi-chain selector that merely changes labels.

The shared core must be reusable. Each adapter must implement real, network-specific functionality and provide evidence appropriate to its underlying protocol.

The architecture must make it possible to develop, test, deploy, and demonstrate each adapter independently without duplicating the core application.

Before implementation, document this architecture and verify that the existing repository can support it. If the existing codebase conflicts with this direction, propose the smallest safe refactor that preserves valuable working functionality.

Do not delete or replace existing working features without examining their dependencies and explaining why the change is necessary.

2. BEGIN WITH REPOSITORY DISCOVERY
Before writing substantial code:

Inspect the complete repository structure.
Read the existing README, package manifests, environment examples, deployment configuration, database schema, migrations, and test suite.
Identify the framework, runtime, package manager, backend, database, authentication, hosting platform, and any existing blockchain integrations.
Identify working features, broken features, security risks, duplicated code, architectural limitations, and incomplete integrations.
Determine which credentials and infrastructure are available without exposing secret values.
Check the current official documentation for all four blockchain ecosystems, the relevant SDKs, network endpoints, test environments, deployment requirements, and applicable hackathon rules.
Record any conflicting or outdated dependencies and identify the safest upgrade path.
Produce a concise implementation plan with dependencies, milestones, acceptance criteria, and known blockers.
Do not assume the current date, chain parameters, SDK methods, contract addresses, network capabilities, or event deadlines from old examples. Verify them against authoritative sources.

Do not stop after producing a plan. Once the architecture and critical assumptions are documented, proceed with implementation unless a genuine external blocker requires human input.

3. REQUIRED MONOREPO ARCHITECTURE
Use a monorepo layout appropriate to the existing technology stack. The following is the target structure, not permission to force an unsuitable framework into the project.

relayguard/
├── apps/
│   ├── web/                  # Main RelayGuard application
│   ├── api/                  # Backend/API, if required
│   ├── mezo-demo/            # Mezo-specific demo configuration
│   ├── solana-x402-demo/     # Solana x402 demo configuration
│   ├── near-demo/            # NEAR-specific demo configuration
│   └── lightning-demo/       # Lightning merchant demo configuration
│
├── packages/
│   ├── core/                 # Shared policy and authorization engine
│   ├── domain/               # Shared domain models and interfaces
│   ├── security/             # Security utilities and validation
│   ├── observability/        # Structured logging and tracing
│   ├── ui/                   # Shared UI components and design system
│   └── testing/              # Shared fixtures and testing utilities
│
├── adapters/
│   ├── mezo/
│   ├── solana-x402/
│   ├── near/
│   └── bitcoin-lightning/
│
├── services/
│   ├── policy-engine/
│   ├── approval-service/
│   ├── settlement-verification/
│   └── audit-service/
│
├── infrastructure/
│   ├── deployment/
│   ├── monitoring/
│   └── database/
│
├── docs/
│   ├── architecture/
│   ├── security/
│   ├── adapters/
│   ├── deployment/
│   └── hackathons/
│
├── scripts/
├── tests/
├── .env.example
├── README.md
├── SECURITY.md
├── CONTRIBUTING.md
└── [existing package-manager and build configuration]
Adjust the structure where justified. Avoid unnecessary microservices, packages, and abstractions. The goal is a modular, maintainable product, not complexity for its own sake.

Shared adapter contract
Define a typed, versioned adapter interface that the core can use without knowing the implementation details of a particular blockchain.

It should cover, as appropriate to each network:

Adapter identity, capabilities, and configuration validation.
Network and environment identification.
Asset, recipient, invoice, and payment request validation.
Transaction or payment preparation.
Authorization context and policy decision.
Transaction execution or safe handoff to a signing/execution service.
Transaction or payment status lookup.
Independent settlement verification.
Normalized transaction references and receipts.
Error classification and retryability.
Timeout, cancellation, and idempotency behavior.
Health checks and integration status.
Structured audit events.
Use explicit capability declarations. Do not pretend all four networks support identical transaction semantics.

For unsupported operations, return a typed, explicit unsupported-capability result. Never return simulated success.

4. RELAYGUARD CORE
Build the shared core around a deterministic authorization boundary.

The AI agent may propose an action. It must never be the authority that approves its own payment.

Implement the following capabilities:

A. Agent identity and access
Authenticated identities for agents and human users.
Agent-specific permissions and ownership.
Scoped API credentials or equivalent secure credentials.
Revocation and credential rotation.
Separation between human users, agents, services, and administrators.
Tenant isolation if the application supports multiple customers.
B. Spending policies
Support configurable rules such as:

Maximum payment per transaction.
Daily, weekly, or other configurable spending limits.
Approved recipients and services.
Approved assets and networks.
Allowed purposes or resource categories where reliably enforceable.
Expiration dates and policy versioning.
Human approval thresholds.
Deny-by-default behavior when a required policy cannot be evaluated.
Define how concurrent requests reserve and consume spending capacity. Avoid race conditions that permit multiple individually valid requests to exceed an aggregate limit.

C. Authorization lifecycle
Implement an explicit transaction state machine, for example:

REQUESTED → VALIDATING → AUTHORIZED → PENDING_EXECUTION → SUBMITTED → CONFIRMED

Include suitable failure, rejection, cancellation, expiration, and reconciliation states.

Never treat a requested transaction, an authorized transaction, a submitted transaction, or a provider’s optimistic response as proof of final settlement.

D. Human approvals
Approval requests with authenticated approver identity.
Expiring approval challenges.
Binding approvals to the exact transaction intent, network, asset, recipient, amount, and relevant policy version.
Rejection, cancellation, and expiration handling.
Replay prevention.
Complete audit trails.
A change to a material transaction parameter must invalidate the original approval.

E. Risk and policy engine
Use deterministic rules for enforceable security decisions.

AI may assist with explanations, classifications, or recommendations, but must not bypass hard policy restrictions.

Use strict schemas and validate all AI-generated or externally supplied transaction proposals before they reach an execution boundary.

F. Audit and receipts
Record the authorization decision, applicable policy version, approval history, execution attempts, transaction reference, settlement evidence, and final status.

Protect audit records against unauthorized alteration. Minimize personal data and never log secrets.

Receipts must distinguish between pending, failed, confirmed, and otherwise protocol-specific settlement states.

5. IMPLEMENT FOUR REAL BLOCKCHAIN ADAPTERS
Each adapter must be a real integration, not a UI-only placeholder.

Adapter 1: Mezo
Build a Mezo-specific MUSD/MEZO payment and transaction authorization workflow.

Requirements:

Verify the current supported Mezo networks, token details, SDKs, and relevant transaction interfaces.
Implement supported MUSD and/or MEZO operations appropriate to the selected hackathon track.
Validate the chain, asset, recipient, amount, and applicable spending policy.
Integrate a legitimate signing and transaction submission flow appropriate to the network.
Verify the transaction through authoritative network or provider data.
Display transaction references and actual settlement status.
Support a repeatable testnet demo where available.
Document the precise integration and deployment requirements.
Do not invent contract addresses, assume token availability, or claim a successful integration based on an explorer link alone.

Adapter 2: Solana x402
Build an end-to-end payment-to-access workflow.

The intended flow:

An agent requests a protected resource.
The resource server returns the appropriate payment requirement.
RelayGuard validates the requirement and evaluates its spending policy.
Required human approval is obtained.
A legitimate x402-compatible payment flow is executed.
The relevant payment is verified according to the actual x402 version and Solana settlement mechanism.
The protected resource is delivered only when the required payment condition is satisfied.
The transaction reference and resource-delivery result are recorded.
Requirements:

Verify current official x402 documentation and Solana implementation details.
Use the appropriate supported client, facilitator, and server interfaces.
Validate network, asset, recipient, amount, and expiry requirements.
Prevent replay, duplicate execution, and duplicate resource fulfillment.
Distinguish an authorization response from independently verified payment settlement.
Make the complete workflow reproducible on an appropriate supported test environment.
Include an actual protected resource endpoint and an actual payment verification path.
A simulated x402 response is not sufficient for the completed integration.

Adapter 3: NEAR Protocol
Build a NEAR-specific agent security and policy enforcement workflow.

Requirements:

Verify current official NEAR documentation and supported capabilities.
Integrate the most relevant native transaction, account, signing, permission, or agent capabilities supported by the selected implementation.
Enforce RelayGuard’s spending and authorization policies before execution.
Use least-privilege credentials and explicit signing boundaries.
Validate the intended network and transaction parameters.
Verify execution using authoritative network evidence.
Record the relevant transaction reference and normalized audit events.
Demonstrate a concrete NEAR-native capability rather than merely connecting to a NEAR RPC endpoint.
Do not claim that the core policy engine is enforced on-chain unless the implementation actually provides and verifies that guarantee.

Adapter 4: Bitcoin Lightning
Build a Lightning payment verification and merchant settlement workflow suitable for an African merchant use case.

Requirements:

Verify the chosen Lightning integration, provider or node interface, and available test environment.
Validate invoice amount, destination information where available, payment hash or identifier, expiry, and applicable policy.
Prevent invoice substitution, replay, duplicate payment attempts, and incorrect order fulfillment.
Execute or hand off payments only through a clearly defined and authorized mechanism.
Verify actual payment status using the selected Lightning implementation’s authoritative interface.
Handle pending, failed, expired, successful, and ambiguous outcomes.
Issue a receipt tied to the verified payment and merchant order.
Demonstrate a complete agent-to-merchant workflow.
Clearly document custodial versus non-custodial assumptions, provider dependencies, operational costs, and limitations.

Never expose node credentials, macaroon secrets, provider API keys, or wallet signing secrets to the browser.

6. INDEPENDENT DEPLOYMENT WITHOUT DUPLICATED CODE
The core repository must support four distinct deployments or independently accessible demo environments.

Target deployments:

RelayGuard Mezo Demo.
RelayGuard Solana x402 Demo.
RelayGuard NEAR Demo.
RelayGuard Lightning Demo.
Use the existing hosting platform where practical. Select additional infrastructure only when required.

Implement:

Environment-specific configuration.
Explicit network selection.
Separate RPC/provider configuration.
Isolated secrets for each deployment.
Appropriate database and tenancy boundaries.
Independent health checks.
Per-adapter feature flags.
Separate deployment commands or workflows.
Deployment documentation and rollback instructions.
Reproducible builds from the same canonical repository.
For example, a deployment configuration may enable only the Solana adapter while using the shared core and UI. Another deployment may enable Mezo and its MUSD workflow.

Do not hardcode private credentials or network-specific assumptions into the shared core.

Create separate CI/CD deployment jobs or equivalent reproducible workflows. Changes to one adapter must not silently break the others.

A deployment is complete only when the deployed application is reachable, the intended adapter is correctly configured, and its supported workflow passes the appropriate smoke tests.

Do not claim four live deployments if credentials, infrastructure, or external approvals are unavailable.

7. PRODUCT DESIGN AND USER EXPERIENCE
The product must look and feel like professional financial infrastructure, not a generic AI dashboard.

Build a cohesive design system with:

A clear product identity.
Consistent typography, spacing, color, and interaction patterns.
High-quality desktop and mobile layouts.
Clear transaction lifecycle states.
An intuitive policy creation and editing experience.
A transaction approval queue.
An agent activity view.
A useful audit and settlement history.
Adapter-specific demo experiences.
Accessible forms, focus states, contrast, and keyboard interactions.
Responsive loading, empty, success, warning, and error states.
Prioritize clarity, trust, and speed.

Do not display fake balances, invented transactions, fabricated analytics, or fake live network statuses.

Label demo data clearly. Make the distinction between sandbox data and verified network data unmistakable.

Do not make security-critical actions depend on animation, color alone, or ambiguous buttons.

8. SECURITY, PERFORMANCE, AND RELIABILITY
Conduct a threat model before declaring the product ready.

Include:

Authentication and authorization.
API rate limiting and abuse prevention.
Input validation and schema enforcement.
Secure secret management.
Server-side authorization.
Protection against replay and duplicate execution.
Idempotent transaction handling.
Database transaction integrity and concurrency controls.
SSRF and unsafe URL handling where relevant.
Dependency and supply-chain risks.
Cross-site scripting, CSRF, injection, and insecure deserialization where relevant.
Webhook signature validation.
RPC/provider failure and malformed response handling.
Logging and sensitive-data redaction.
Safe failure behavior when an external provider is unavailable.
Backup and recovery procedures appropriate to the deployment.
Treat external API responses, wallet metadata, agent output, transaction proposals, and resource URLs as untrusted input.

Use bounded retries, timeouts, and backoff. Do not retry irreversible operations blindly.

Do not claim the application is invulnerable. Report verified protections, residual risks, and unresolved issues honestly.

Performance requirements
Avoid unnecessary network requests and repeated database queries.
Use caching only where it cannot cause unsafe authorization or settlement decisions.
Keep policy evaluation lightweight and deterministic.
Use asynchronous processing for tasks that do not need to block the user interface.
Avoid blocking the main thread with heavy work.
Measure real latency rather than inventing performance figures.
Establish baseline and regression tests for critical workflows.
Do not sacrifice authorization correctness to reduce latency.
9. TESTING AND ACCEPTANCE CRITERIA
Build unit, integration, security, and end-to-end tests.

At minimum, test:

Valid and invalid policy decisions.
Transactions exceeding spending limits.
Unauthorized recipients and assets.
Expired approvals and changed transaction parameters.
Concurrent spending requests.
Duplicate requests and replay attempts.
Provider timeouts and malformed responses.
Unconfirmed or failed settlement.
Successful verified settlement.
Invoice expiration and duplicate payment attempts.
Resource access before and after payment verification.
Adapter misconfiguration.
Network mismatch.
Secrets accidentally appearing in logs or client bundles.
Cross-adapter regression.
Database migration and recovery behavior.
Use mocks only for isolated tests and clearly labeled offline demonstrations. They must not be mistaken for live integration evidence.

Each adapter must have:

Unit tests.
Adapter contract tests.
Integration tests using the appropriate test environment where available.
A reproducible demo procedure.
A verified transaction or payment evidence procedure.
A deployment smoke test.
Do not fabricate passing test results. Report which tests actually ran, which passed, which failed, and which require external credentials or infrastructure.

10. HACKATHON-SPECIFIC DELIVERABLES
Keep the four submissions within the same canonical repository, but give each its own identity and evidence.

Create:

docs/hackathons/mezo/
docs/hackathons/solana-x402/
docs/hackathons/near/
docs/hackathons/dakar-bitcoin/
Each directory must contain, as applicable:

README.md
PITCH.md
DEMO_SCRIPT.md
ARCHITECTURE.md
TEST_RESULTS.md
DEPLOYMENT.md
SUBMISSION_CHECKLIST.md
For each hackathon, document:

The specific problem being solved.
Why the selected blockchain is essential to that implementation.
The exact features implemented specifically for that ecosystem.
The working demo URL, once verified.
The public repository URL.
Setup instructions and required environment variables.
The demo recording plan.
The evidence of actual blockchain execution or settlement.
Known limitations.
How the entry complies with the event’s eligibility, originality, deployment, and submission requirements.
Verify each event’s current rules before finalizing the submission plan.

Do not claim that one shared implementation qualifies for multiple tracks unless the actual requirements support that conclusion.

Do not submit the same unchanged demo four times.

11. DOCUMENTATION AND DEVELOPER EXPERIENCE
The root README must explain:

What RelayGuard does.
The shared-core architecture.
How adapters work.
How to run the application locally.
How to run tests.
How to configure each chain.
How to run each demo.
How to deploy each adapter.
What is implemented versus planned.
Security assumptions and limitations.
Provide:

.env.example with placeholder names only.
Clear installation and migration commands.
Useful error messages.
Database migration instructions.
Development and production configuration guidance.
CI checks.
Troubleshooting documentation.
Avoid undocumented setup steps and machine-specific assumptions.

12. IMPLEMENTATION STRATEGY
Execute in deliberate stages.

Stage 1: Audit and architecture

Inspect the current repository, identify constraints, document the target architecture, and establish a working baseline.

Stage 2: Shared core

Implement domain models, policy evaluation, authorization lifecycle, approval handling, idempotency, and audit logging.

Stage 3: Adapter framework

Define and test the adapter contract, capability negotiation, configuration validation, normalized errors, and settlement verification boundaries.

Stage 4: Blockchain adapters

Implement each adapter using verified current documentation and the actual network-specific mechanisms.

Stage 5: End-to-end workflows

Make each adapter’s user journey work from request through authorization, execution, verification, and receipt.

Stage 6: Independent deployments

Configure and deploy each demo separately using the same canonical codebase.

Stage 7: Hardening and quality assurance

Run tests, security checks, performance measurements, accessibility checks, and deployment smoke tests.

Stage 8: Hackathon packaging

Prepare separate pitches, recordings, evidence, setup instructions, and submission checklists.

Maintain a progress file, such as docs/BUILD_STATUS.md, with completed work, test evidence, unresolved issues, and the next concrete task.

After every significant change, run the relevant tests and fix regressions before proceeding.

Prioritize a fully working end-to-end vertical slice over a large number of incomplete features.

13. OPERATING RULES FOR CODEX
Inspect before changing.
Reuse working code where sensible.
Do not silently discard existing functionality.
Do not create fake integrations to satisfy a checklist.
Do not substitute static UI for functional behavior.
Do not fabricate network transactions, test results, deployment URLs, or credentials.
Do not commit secrets.
Do not bypass security controls to make a demo appear successful.
Do not claim completion without verification.
Do not stop at a plan, design, or architecture document.
Do not ask the user to perform steps that can safely be completed with existing permissions.
When blocked by missing credentials or external infrastructure, finish everything else possible, identify the exact blocker, and provide the minimum necessary next action.
Keep changes incremental, reviewable, and testable.
Preserve a clean Git history where practical.
Use the existing package manager and established project conventions unless there is a documented reason to change them.
Prefer official protocol documentation and maintained SDKs.
Explain major architectural decisions and material trade-offs.
14. DEFINITION OF DONE
RelayGuard is not considered complete merely because it builds or looks convincing.

The target is achieved when:

One canonical repository contains the shared core and all four adapters.
Each adapter implements its intended protocol-specific workflow.
Each adapter has meaningful automated tests.
Each demo can be configured and run independently.
The four deployment configurations are reproducible.
Every claimed live integration has verifiable evidence.
The shared authorization policy is enforced before transaction execution.
Settlement is independently verified before the application reports payment success or releases paid resources.
Security-sensitive failures fail safely.
Cross-adapter regression tests pass.
Documentation accurately reflects implementation status.
Hackathon-specific deliverables are prepared without inventing completed features or results.
The user receives a concise final engineering report identifying what works, what was tested, which deployments are live, which integrations remain blocked, and what must happen next.
FINAL DIRECTIVE
Start by auditing the repository and producing the architecture and implementation plan. Then execute the build.

One repository. One shared RelayGuard Core. Four genuine blockchain adapters. Four independently configurable deployments. Four distinct hackathon demonstrations.

Build for real functionality, security, maintainability, excellent UX, and verifiable results. Quality and truthful evidence take priority over superficial feature count.