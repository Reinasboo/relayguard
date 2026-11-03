# Mezo Demo Script

## RelayGuard integrated product

1. Start with `npm start` and show the single RelayGuard workspace: Mezo Testnet status, merchant checkout, and agent API.
2. Sign in with the Supabase email account; explain that customer checkout remains shareable and doesn't require an account.
3. Create a small fixed MUSD invoice, show its link and QR, then open its customer page. Explain that the buyer's wallet signs the transfer and RelayGuard verifies receipt/event evidence.
4. In the integrated paid-API panel, request the x402 resource. Show the 402 payment-required response and its exact MUSD, network, and merchant recipient requirements.
5. Show the [Express x402 integration guide](../../integrations/express-x402.md): merchants add the source SDK/adapter to their own Node.js API routes, keep their website and protected response, and store the resource-scoped key server-side. Explain that this is middleware rather than a browser checkout widget.
6. The verified testnet demo has a 1.00 MUSD invoice payment and a 0.001 MUSD x402 payment. Show their different settlement transactions and the merchant's shared receiving address.
7. To repeat the x402 flow, use a connected Mezo wallet with MUSD and BTC for gas. If needed, RelayGuard requests an exact MUSD allowance for Permit2, waits for confirmation, then asks the wallet to sign the payment; the facilitator handles gas for the MUSD settlement.
8. Show the deployed operator trove health and explain the policy: human review below RelayGuard's 150% ICR buffer, block below Mezo's 110% minimum, and fail closed if protocol state is unavailable. For an MUSD authorization, show the block-pinned policy snapshot and its audit commitment; demonstrate that a changed risk tier requires cancelling and submitting a fresh request. The production dashboard currently reads healthy; present threshold outcomes as policy behavior unless independently verified in a controlled live test. This control applies to the configured operator signer, not to the checkout buyer.

## Existing authorization proof (optional)

1. Show the operator policy console, allowlisted recipient, and amount limits.
2. Demonstrate policy authorization without execution, then show an unallowlisted destination denied.
3. Show the previously confirmed `0.000001 BTC` self-transfer and matching receipt/audit evidence. Make clear this proves the native BTC path, not MUSD checkout.

## Live-network note

The public app is available at [relayguard.vercel.app](https://relayguard.vercel.app). The latest production deployment and hosted audit migration are live; perform a fresh end-to-end QR/wallet pass before recording the demo. Testnet invoice and x402 settlement evidence is recorded in [test results](./TEST_RESULTS.md). Do not present testnet transactions as mainnet payments.
