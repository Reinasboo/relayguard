# Adapter framework

RelayGuard keeps one shared core and four protocol-specific adapters behind a strict contract. The implementation is intentionally honest:

- A capability is only advertised if the adapter clearly supports it.
- Execution and settlement verification are blocked when the required provider, network, credentials, or policy are absent.
- No adapter claims live chain success without authoritative provider or network evidence.

## Supported adapters

- Mezo: MUSD/MEZO and transaction authorization workflows
- Solana x402: resource access and payment verification workflows
- NEAR: policy enforcement and native-capability execution boundaries
- Bitcoin Lightning: invoice verification and merchant settlement workflows

## Current status

Each adapter is scaffolded as a typed implementation shell. Configuration validation is strict, but execution and verification remain intentionally disabled in this repository because no real provider credentials, RPC endpoints, wallets, or network infrastructure were provided.

This is a safe checkpoint before a protocol-specific integration is selected and verified against official docs, testnets, and live evidence.
