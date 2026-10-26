# RelayGuard Mezo Buildathon

RelayGuard targets the Access & Distribution track with two MUSD payment paths in one merchant workspace: QR invoices for people and x402-protected API access for agents. Both settle to the same merchant wallet, and both Mezo Testnet flows have on-chain verification evidence. See the [product strategy](./PRODUCT_STRATEGY.md).

## Scope

- Policy-bound transaction approval before execution
- Valid Mezo EVM address and value validation
- Native BTC transfer support and optional MUSD ERC-20 transfer support
- RPC-based transaction receipt lookup and settlement verification
- Durable merchant invoices with expiry, local QR generation, direct wallet checkout, and invoice settlement status
- Honest fail-closed behavior when RPC credentials or a signing key are missing

## Required environment

- `MEZO_RPC_URL`: official Mezo RPC endpoint, preferably Mezo testnet for the buildathon
- `MEZO_NETWORK`: `testnet` for this local demo
- `MEZO_PRIVATE_KEY`: signer wallet private key; never commit it
- `MEZO_SIGNER_ADDRESS`: optional signer address for audit context
- `MEZO_TOKEN_ADDRESS`: official Mezo testnet MUSD contract `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`

## Current implementation status

Automated tests pass. A 1.00 MUSD invoice payment and a 0.001 MUSD facilitator-settled x402 payment were confirmed on Mezo Testnet, with both paying the same receiver; see [test results](./TEST_RESULTS.md). Merchant authentication works. The application still uses local SQLite and binds to loopback, so it is not yet a public deployment; browser wallet signing and cross-device access still need validation.
