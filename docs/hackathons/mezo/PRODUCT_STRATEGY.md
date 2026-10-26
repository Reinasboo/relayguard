# Product upgrade: Mezo MUSD Merchant Checkout

## Why this is the right Mezo problem

RelayGuard started as a generic agent-payment control panel. That proved the authorization and Mezo receipt path, but it did not yet give MUSD a concrete reason to be used.

Mezo's official [Borrow and Mint MUSD guide](https://mezo.org/docs/users/borrow/mint-musd/) says the minimum loan is 1,800 MUSD, with a 200 MUSD gas deposit and at least 2,000 MUSD of opening debt. That is a notable onboarding hurdle for someone who only wants to make or accept a small everyday payment. The same guide lists the official Mezo Testnet MUSD contract and explains how test MUSD is obtained.

## Product

**RelayGuard** connects MUSD merchant acceptance to MUSD-powered software distribution in one product. A merchant can create a MUSD-denominated invoice with a shareable checkout URL/QR for a person, or expose a low-cost x402-protected resource for an agent. The person signs an exact direct MUSD transfer from their Mezo-compatible wallet. The agent signs x402 payment authorization and the Mezo facilitator verifies and settles it, sponsoring gas. Both workflows target the merchant's same receiving wallet.

This is an access-and-distribution product rather than another generic transfer screen:

- Merchants can quote small MUSD amounts without building a wallet connection, token transfer, QR, invoice, or settlement watcher.
- Agents can pay for a protected HTTP resource in MUSD using the x402 protocol, without a custom integration or buyer-side gas transaction.
- The customer's wallet remains the signer; RelayGuard does not take custody of the checkout payment.
- The merchant receives MUSD directly; the merchant does not need to borrow MUSD to accept it.
- The checkout page links to Mezo's own MUSD onboarding guidance when a customer has not acquired MUSD.
- The existing agent policy console remains the operator's control plane for treasury and automation flows.

## Implemented flow

1. Operator configures a merchant name/address; the merchant address must also be in the payment allowlist.
2. Merchant creates a fixed-amount MUSD invoice with an expiry.
3. RelayGuard stores the invoice durably and returns a shareable link and locally generated QR image.
4. Customer wallet switches to Mezo Testnet and connects from the checkout page.
5. Backend checks invoice state, token contract, buyer MUSD balance, recipient policy, and exact amount.
6. Customer reviews and signs the direct ERC-20 transfer in their wallet.
7. Backend persists the transaction reference, reads the Mezo receipt, decodes the matching `Transfer` event, and checks sender, recipient, amount, asset, and authorization before marking the invoice paid.
8. If the wallet rejects before broadcast, the authorization is cancelled and the invoice is released. If the wallet broadcasts but the API response fails, the page attempts reconciliation and warns the customer not to pay again.

The connected x402 resource uses the Mezo facilitator's `exact` scheme at `eip155:31611`. An unpaid request returns a protocol 402 response naming the official MUSD token, exact price, and merchant recipient. The browser uses the x402 EVM client and the connected wallet to create the typed-data authorization; the resource unlocks only after a successful facilitator settlement response.

## Honest demo limitations

- The merchant receiving wallet is `0x840E5bBF20D725f581752f8A4021ADd730550d47`; its private key is kept in ignored `.env.wallets.local` and must not be exposed.
- The test buyer/operator wallet borrowed 1,800 MUSD and completed both a 1.00 MUSD merchant invoice payment and a 0.001 MUSD x402 resource payment. Both transactions settled to the same merchant receiver and were verified.
- The merchant receiver now holds 1.001 MUSD from those test transactions. These are testnet amounts and transactions, not evidence of mainnet readiness.
- The borrower has an active testnet trove with 0.045 BTC collateral and approximately 2,001.8 MUSD opening debt, including the MUSD gas compensation and issuance fee. This testnet collateral remains subject to the same protocol liquidation rules; do not use a mainnet wallet for a demo.
- The current app binds to `127.0.0.1`. Its QR/link is only reachable on the same machine; public/mobile checkout requires a secure deployment.
- Supabase Auth is wired for merchant sessions and operator APIs; SQLite invoice listing is scoped by Supabase user ID. The remote Supabase SQL migration is prepared but not applied, and invoice/audit persistence remains local SQLite.
- Merchant profile/address is currently configured for this single demo merchant; multi-merchant profiles and hosted Postgres persistence are not implemented.
- The previously completed BTC transaction proves the Mezo execution/receipt path only; it is not MUSD checkout evidence.

## Next buildathon-ready steps

1. Manually verify buyer wallet signing and QR checkout from a second device/browser.
2. Apply the Supabase migration and move invoice, authorization, and audit persistence to hosted Postgres.
3. Configure the production host, HTTPS, redirects, operations, and signing boundaries before sharing a public URL.
4. Capture the merchant-created QR, buyer payment, agent resource access, settlement proofs, and audit evidence in a short demo.
