# RelayGuard Mezo Buildathon

This overview and its early test count are historical. The current Wave 2 package, candidate status, and outstanding release gates are in [SUBMISSION.md](./wave2/SUBMISSION.md), [VALIDATION.md](./wave2/VALIDATION.md), and [RELEASE_CHECKLIST.md](./wave2/RELEASE_CHECKLIST.md).

RelayGuard targets the Access & Distribution track with two MUSD payment paths in one merchant workspace: QR invoices for people and x402-protected API access for agents. Merchants can integrate the Express x402 SDK/adapter into their own Node.js API routes while keeping their own website and server. Both paths settle to the merchant's verified wallet, and both Mezo Testnet flows have on-chain verification evidence. See the [product strategy](./PRODUCT_STRATEGY.md) and [integration guide](../../integrations/express-x402.md).

## Scope

- Policy-bound transaction approval before execution
- Valid Mezo EVM address and value validation
- Native BTC transfer support and optional MUSD ERC-20 transfer support
- RPC-based transaction receipt lookup and settlement verification
- Durable merchant invoices with expiry, local QR generation, direct wallet checkout, and invoice settlement status
- Buyer-side MUSD/BTC and estimated-gas preflight before invoice authorization
- Optional, separate, explicitly confirmed Mezo Testnet trove opening for eligible underfunded buyers
- Honest fail-closed behavior when RPC credentials or a signing key are missing

## Required environment

- `MEZO_RPC_URL`: official Mezo RPC endpoint, preferably Mezo testnet for the buildathon
- `MEZO_NETWORK`: `testnet` for this local demo
- `MEZO_PRIVATE_KEY`: signer wallet private key; never commit it
- `MEZO_SIGNER_ADDRESS`: optional signer address for audit context
- `MEZO_TOKEN_ADDRESS`: official Mezo testnet MUSD contract `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`

## Current implementation status

The current local suite passes 63 tests. A 1.00 MUSD invoice payment and a 0.001 MUSD facilitator-settled x402 payment were confirmed on Mezo Testnet, with both paying the same receiver; see the historical [test results](./TEST_RESULTS.md). The latest source is deployed, but the migration and production configuration gates in the [release checklist](./wave2/RELEASE_CHECKLIST.md) remain open. Real browser-wallet signing, a fresh production invoice QR, and the borrow review with a real wallet remain unverified. No borrow transaction was broadcast for the current candidate.
