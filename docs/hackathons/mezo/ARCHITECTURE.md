# Mezo Architecture

RelayGuard combines a shared policy/audit core with merchant MUSD checkout, an x402 paid-resource endpoint, and the Mezo adapter. Human checkout is signed by the buyer's wallet; x402 authorization is settled by the Mezo facilitator; the operator treasury console uses a separate local operator key.

## Components

- Shared RelayGuard Core: policy evaluation, idempotency, approvals, audit hash chain
- Checkout Service: SQLite-backed local and Postgres-backed Vercel MUSD invoice lifecycle, expiry, authorization binding, transaction reference, and settlement state
- Mezo Adapter: configuration validation, native BTC transfer or MUSD receipt/event settlement verification
- Merchant UI: Supabase-authenticated invoice creation/history, shareable checkout URL, QR image, customer wallet connection, trove health context, and an integrated x402 paid-resource client
- Merchant Express SDK/adapter: source middleware installed in the merchant's own Node.js API to protect its routes; RelayGuard supplies verified x402 resource terms while the merchant owns its storefront, server, and response
- x402 middleware: Mezo facilitator capability sync, MUSD exact-payment requirement, and protected resource release after facilitator settlement
- Authentication: verified Supabase bearer tokens for merchant invoice management and operator APIs; invoice listings are scoped by authenticated merchant user ID
- RPC layer: official Mezo or Mezo Testnet RPC endpoint
- Signing boundary: private key stored outside the browser; not committed to source control

## Execution flow

## Merchant checkout flow

1. Merchant creates a fixed-amount MUSD invoice with expiry; the local SQLite or production Postgres store persists it.
2. RelayGuard returns a checkout URL and QR code.
3. Customer connects their own wallet. The API validates invoice state, MUSD token, payer balance, merchant recipient, amount, and policy before creating an authorization.
4. The customer wallet signs and broadcasts the exact ERC-20 transfer directly to the merchant.
5. RelayGuard records the hash and reads Mezo transaction/receipt data independently.
6. The adapter requires a matching ERC-20 `Transfer` event; the server compares payer, merchant, amount, asset, and authorization before marking the invoice paid.

## Operator flow

1. An automation system proposes a Mezo payment request.
2. For MUSD, RelayGuard reads the configured operator's trove status, PriceFeed, and protocol ICR at one pinned block. It requires human approval below RelayGuard's 150% review buffer, blocks spending below Mezo's 110% minimum, and fails closed if protocol state is unavailable.
3. RelayGuard validates recipient, amount, chain, asset, and spending policy.
4. Required human approval triggers an approval challenge.
5. The local Mezo signer explicitly submits the transaction.
6. Native BTC settlement matches actual recipient/value; MUSD settlement requires a matching `Transfer` event.

## Agent paid-resource flow

1. Merchant registers its API route and MUSD resource in RelayGuard, then adds the Express SDK/adapter to its own Node.js API using a server-side resource key.
2. An agent requests the protected HTTP resource without payment credentials.
3. x402 middleware returns HTTP 402 with exact MUSD payment requirements for Mezo Testnet and the merchant recipient.
4. A buyer client signs the typed-data payment authorization with its connected wallet and retries the request.
5. The facilitator verifies and settles the payment, sponsoring gas; the middleware releases the resource only after successful settlement.

The adapter is currently provided as source code, not as a published npm package or browser checkout widget. See the [Express x402 integration guide](../../integrations/express-x402.md).

## Trust boundary

The adapter never returns success based on a queued, simulated, or optimistic RPC response alone. Final success requires a successful receipt and evidence matching the transfer; a transaction hash alone is insufficient. Merchant invoice and operator APIs require a verified Supabase session, and invoice listings are scoped to the authenticated user. Production runs on Vercel with Supabase Postgres; local development defaults to SQLite. Public checkout routing is deployed, while a complete production QR-to-wallet settlement still requires a fresh end-to-end verification.
