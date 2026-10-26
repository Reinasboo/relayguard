# Mezo Architecture

RelayGuard combines a shared policy/audit core with merchant MUSD checkout, an x402 paid-resource endpoint, and the Mezo adapter. Human checkout is signed by the buyer's wallet; x402 authorization is settled by the Mezo facilitator; the operator treasury console uses a separate local operator key.

## Components

- Shared RelayGuard Core: policy evaluation, idempotency, approvals, audit hash chain
- Checkout Service: SQLite-backed MUSD invoice lifecycle, expiry, authorization binding, transaction reference, and settlement state
- Mezo Adapter: configuration validation, native BTC transfer or MUSD receipt/event settlement verification
- Merchant UI: Supabase-authenticated invoice creation/history, shareable local checkout URL, QR image, customer wallet connection, and an integrated x402 paid-resource client
- x402 middleware: Mezo facilitator capability sync, MUSD exact-payment requirement, and protected resource release after facilitator settlement
- Authentication: verified Supabase bearer tokens for merchant invoice management and operator APIs; local SQLite persists records scoped by authenticated merchant user ID
- RPC layer: official Mezo or Mezo Testnet RPC endpoint
- Signing boundary: private key stored outside the browser; not committed to source control

## Execution flow

## Merchant checkout flow

1. Merchant creates a fixed-amount MUSD invoice with expiry; SQLite persists it.
2. RelayGuard returns a checkout URL and QR code.
3. Customer connects their own wallet. The API validates invoice state, MUSD token, payer balance, merchant recipient, amount, and policy before creating an authorization.
4. The customer wallet signs and broadcasts the exact ERC-20 transfer directly to the merchant.
5. RelayGuard records the hash and reads Mezo transaction/receipt data independently.
6. The adapter requires a matching ERC-20 `Transfer` event; the server compares payer, merchant, amount, asset, and authorization before marking the invoice paid.

## Operator flow

1. An automation system proposes a Mezo payment request.
2. RelayGuard validates recipient, amount, chain, asset, and spending policy.
3. Required human approval triggers an approval challenge.
4. The local Mezo signer explicitly submits the transaction.
5. Native BTC settlement matches actual recipient/value; MUSD settlement requires a matching `Transfer` event.

## Agent paid-resource flow

1. An agent requests the protected HTTP resource without payment credentials.
2. x402 middleware returns HTTP 402 with exact MUSD payment requirements for Mezo Testnet and the merchant recipient.
3. A buyer client signs the typed-data payment authorization with its connected wallet and retries the request.
4. The facilitator verifies and settles the payment, sponsoring gas; the middleware releases the resource only after successful settlement.

## Trust boundary

The adapter never returns success based on a queued, simulated, or optimistic RPC response alone. Final success requires a successful receipt and evidence matching the transfer; a transaction hash alone is insufficient. Merchant invoice and operator APIs require a verified Supabase session, and invoice listings are scoped to the authenticated user. The remote database migration is pending, so application records remain in local SQLite; QR links are only reachable on the machine running the loopback-only server. A public deployment is not configured.
