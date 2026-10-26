# Mezo Demo Script

## RelayGuard integrated product

1. Start with `npm start` and show the single RelayGuard workspace: Mezo Testnet status, merchant checkout, and agent API.
2. Sign in with the Supabase email account; explain that customer checkout remains shareable and doesn't require an account.
3. Create a small fixed MUSD invoice, show its link and QR, then open its customer page. Explain that the buyer's wallet signs the transfer and RelayGuard verifies receipt/event evidence.
4. In the integrated paid-API panel, request the x402 resource. Show the 402 payment-required response and its exact MUSD, network, and merchant recipient requirements.
5. The verified testnet demo has a 1.00 MUSD invoice payment and a 0.001 MUSD x402 payment. Show their different settlement transactions and the merchant's shared receiving address.
6. To repeat the x402 flow, use a connected Mezo wallet with MUSD and BTC for gas. If needed, RelayGuard requests an exact MUSD allowance for Permit2, waits for confirmation, then asks the wallet to sign the payment; the facilitator handles gas for the MUSD settlement.

## Existing authorization proof (optional)

1. Show the operator policy console, allowlisted recipient, and amount limits.
2. Demonstrate policy authorization without execution, then show an unallowlisted destination denied.
3. Show the previously confirmed `0.000001 BTC` self-transfer and matching receipt/audit evidence. Make clear this proves the native BTC path, not MUSD checkout.

## Live-network note

The app is restricted to loopback, so its QR/link is not reachable from another device and is not a public deployment. Testnet invoice and x402 settlement evidence is recorded in [test results](./TEST_RESULTS.md). Do not present testnet transactions as mainnet payments.
