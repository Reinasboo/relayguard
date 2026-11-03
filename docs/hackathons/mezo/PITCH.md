# RelayGuard Mezo Pitch

**RelayGuard makes MUSD useful to both people and software agents.**

A merchant creates an exact-amount MUSD invoice with a shareable checkout page and QR code, or integrates RelayGuard's Express x402 SDK/adapter into its own Node.js API to protect a website route or paid resource. People pay directly from their own Mezo-compatible wallet; agents use a signed x402 authorization settled by Mezo's facilitator. RelayGuard checks invoices, enforces authenticated merchant controls, and reports paid status only after settlement evidence is verified. The current SDK/adapter is source code to add to a merchant project, not a published npm package or a browser checkout widget.

## The need

Mezo's [MUSD borrowing guide](https://mezo.org/docs/users/borrow/mint-musd/) documents a 1,800 MUSD minimum loan plus a 200 MUSD gas deposit. That can make sense for a borrower but is a steep route for someone who only wants to make a small payment. Merchants also need an easy way to accept MUSD without building token plumbing themselves.

RelayGuard addresses the distribution gap with one receiving wallet and two familiar entry points: a QR checkout for customers and an x402 resource for agents. The x402 facilitator sponsors buyer gas. Direct invoice customers still need MUSD and BTC for gas; RelayGuard does not claim to remove the need to acquire MUSD.

## Why Mezo

Mezo combines BTC-backed MUSD with an EVM-compatible token flow. RelayGuard uses Mezo Testnet chain ID 31611 and the documented testnet MUSD contract, verified on-chain. Mezo's native fee asset is BTC; it is not mislabeled as MEZO. A direct buyer-wallet transfer is non-custodial for checkout funds.

## What is working

- MUSD merchant invoice creation and durable lifecycle/expiry.
- Shareable checkout URL and locally generated QR.
- Buyer-side wallet connection and exact ERC-20 transfer request.
- Balance and policy preflight; the invoice stays open when preflight fails.
- Receipt and `Transfer`-event validation against the precise payer, merchant, amount, token, and authorization.
- x402 paid-resource middleware, Mezo Testnet facilitator discovery, MUSD price/recipient requirements, and wallet typed-data client.
- Express x402 adapter for protecting a merchant's own Node.js API route; the merchant keeps the website, server, and protected response while settlement goes to its verified wallet.
- Supabase email authentication for merchant invoice management and operator audit/payment APIs.
- Existing agent control plane for explicit operator-authorized testnet BTC execution.

Automated checks pass. The buyer wallet borrowed testnet MUSD, then completed a 1.00 MUSD invoice payment and a 0.001 MUSD x402 resource payment. RelayGuard verified the invoice's matching ERC-20 event; the x402 facilitator settled the paid request and returned the protected resource. Both paths paid the same merchant wallet. The public Vercel app and Supabase Postgres runtime are active; health/config, x402 challenge, checkout routing, and live trove-health display have been smoke-tested. A fresh production QR-to-wallet settlement and controlled policy-boundary tests remain. Wave 2's trove-aware spending rules and bounded checkout recovery are deployed and covered by local tests. See the [Wave 2 deck](./WAVE_2_DECK.md) for the proposed business model and milestones.
