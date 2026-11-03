# Mezo Test Results

## Automated results

- `npm test` passes 45 tests, including trove risk tiers and exact policy boundaries, block-pinned protocol reads, authorization lifecycle, SQLite persistence, audit-chain integrity, adapter conformance, invoice lifecycle, and owner scoping.
- Core policy tests cover spending limits, approval expiry, idempotency, stale-policy cancellation, and tamper detection for stored Mezo evidence.
- Settlement verification compares native transaction value/recipient and requires an MUSD `Transfer` log matching the submitted call; the API then compares those fields to the stored authorized intent.
- `node --check public/app.js`, TypeScript build, and `npm audit --omit=dev` pass; production dependency audit found zero advisories.

## Loading and latency behavior

- The signed-in dashboard requests its protected protocol snapshot directly; the public view requests only the public snapshot. This avoids serial health and duplicate-snapshot reads. FAQ-only entry skips operator RPC and application configuration requests until navigating to Payments or Merchant.
- Merchant invoice history and x402 integrations load concurrently. A created invoice and checkout link appear as soon as creation succeeds; the activity refresh no longer delays or masks the success message.
- A delayed local API mock (250 ms profile/config/resource responses and 1.5 s invoice-history responses) confirmed concurrent loading and showed the new invoice card about 300 ms after the create response, while history was still refreshing. A missing mock QR endpoint displayed the checkout-link fallback instead of a broken image.
- Wallet, policy, account, invoice, and receipt-verification actions now expose progress states. Browser API calls are bounded by the existing 15-second timeout; safe load failures offer retry, and status-read failures keep payment controls paused.
- These are controlled local UI timings, not production latency measurements or an SLA. Vercel cold starts and Mezo RPC latency remain variable.
- No live wallet signature or transaction was performed for this loading-state change: the shared browser pages did not expose an injected wallet provider. The test-wallet page available in the prior production mock is not treated as a real user wallet.

## Merchant checkout evidence and limits

- Live local API smoke check created an open `2.50 MUSD` invoice, served the checkout page (HTTP 200), and returned a 2,703-byte PNG QR code pointing to it.
- Historical pre-funding check: the API rejected a zero-MUSD buyer with `insufficient_musd` before writing an authorization or reserving the invoice. A follow-up read confirmed the invoice remained open with no authorization.
- A malformed transaction hash was rejected with HTTP 400 before attempting authorization lookup or changing state.
- Authenticated merchant invoice creation returned a one-MUSD invoice, then an exact-payer authorization for the borrower wallet.
- Buyer transferred `1.00 MUSD` to the configured merchant receiver; the API submitted and independently verified the receipt and matching ERC-20 `Transfer`, moving the invoice to `paid`.
- Invoice payment: [`0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868`](https://explorer.test.mezo.org/tx/0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868), successful in block `16372688`, gas used `34585`. Verified invoice `29d9a318-d387-4676-b97c-c836d0fdc706` is `paid` and references this transaction.

## x402 and Supabase checks

- The Mezo facilitator `/supported` response advertises `eip155:31611`, `exact`, and canonical MUSD at `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`.
- Live local `GET /api/paid-resource` returns HTTP 402 with a Base64 `PAYMENT-REQUIRED` header. Decoded terms specify 0.001 MUSD (`1000000000000000` atomic units), chain `eip155:31611`, and the generated merchant recipient.
- Supabase CLI authenticated and linked to the `relayguard` project; email Auth is enabled and loopback redirect URLs are allowlisted.
- Invoice-list endpoint rejects unauthenticated access. The owner has since confirmed that merchant sign-in works.
- The three Supabase migrations are applied to the linked production project. The additive trove-evidence audit migration was dry-run, applied, and confirmed in remote migration history.
- The production Vercel deployment starts against hosted Postgres with the updated audit schema; the public Mezo Testnet health route returns a block-pinned trove snapshot.
- x402 payment settled through the Mezo facilitator, and the paid resource returned HTTP 200. The response transaction was independently checked on Mezo Testnet.
- The x402 resource payment is [`0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c`](https://explorer.test.mezo.org/tx/0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c), successful in block `16372674`; receipt status `success`, gas used `125000`. Buyer balance decreased by `0.001 MUSD`; merchant balance increased by the same amount.
- Permit2 required a token allowance before settlement. An exact `0.001 MUSD` allowance (not unlimited) was granted to canonical Permit2 at `0x000000000022D473030F116dDEE9F6B43aC78BA3`: [`0xe5ca4098ac03da35d7cedbbd76389a2bba0280d988d97636a5086a6ea075d20a`](https://explorer.test.mezo.org/tx/0xe5ca4098ac03da35d7cedbbd76389a2bba0280d988d97636a5086a6ea075d20a), successful in block `16372668`. The approval was limited to the x402 charge.
- The browser x402 client now checks Permit2 allowance, requests only the exact charge if approval is needed, waits for a successful receipt, and verifies the resulting allowance. Automated tests cover exact approval calldata, receipt and allowance checks, and skipping an already-sufficient approval.
- The server is loopback-only. Browser-wallet interaction and cross-device checkout have not been manually verified; this environment has no injected EVM wallet provider. The local signer exercised the x402 client protocol end to end.

## Checkout preflight and optional trove flow

- Buyer checkout now checks the connected wallet’s Mezo Testnet MUSD balance and BTC gas balance before requesting invoice authorization. It estimates the direct transfer gas when the MUSD balance is sufficient; insufficient MUSD or BTC gas does not create an authorization or submit a payment.
- If the connected wallet has no active trove and the configured minimum borrow can cover the invoice shortfall, the page offers an optional Testnet `BorrowerOperations.openTrove` review. It reads the live minimum net debt, fee exemption and borrowing fee, interest rate, PriceFeed, and trove status; it estimates collateral at RelayGuard’s conservative 200% ICR app threshold and simulates/estimates the transaction before showing the wallet confirmation.
- Borrowing is separate from checkout: the borrower reviews the debt, fee, interest, collateral, oracle price, and gas; explicitly acknowledges liquidation risk; and signs a distinct wallet transaction. After a successful receipt, the invoice remains unpaid and the buyer must separately continue to the exact MUSD payment. Existing troves are not modified, and a minimum borrow that cannot cover the invoice shortfall is not offered.
- Controlled tests cover exact 110%/150% policy boundaries, invalid PriceFeed values, protocol-read failures, and collateral rounding at the 200% target. `npm run typecheck`, `node --check public/app.js`, and `git diff --check` pass.
- A local browser smoke test with a mocked EIP-1193 provider exercised the insufficient-MUSD preflight and optional trove panel, then verified that an invoice shortfall larger than the minimum borrow is not offered an unusable borrow flow. Neither case called invoice authorization or broadcast a transaction.
- Mocked-wallet browser regression checks covered gas-insufficient rejection before authorization, gas-cost display at Mezo's wei-scale fees, wallet-rejection release, resuming a previously authorized invoice with the same payer, and a simulated authorize-submit-verify-to-paid path. The QR image loaded when the mock included a generated PNG response for the QR route; the earlier blank mock omitted that route. These are UI simulations, not wallet signatures or on-chain payments.
- Read-only RPC checks confirmed Testnet chain ID 31611, deployed Mezo contracts, a live PriceFeed, `minNetDebt` of 1,800 MUSD, 1% current interest (100 basis points), and the observed borrowing-fee terms. No transaction was broadcast for this feature.
- Production browser mock against `https://relayguard.vercel.app/pay/prod-mock-checkout` loaded a generated 320×320 QR image and connected a mocked EIP-1193 wallet. The underfunded state showed a zero MUSD balance, offered the separate optional trove flow, and did not create an invoice authorization or submit a transaction.
- The production mock could not complete the borrow review because its provider does not implement `eth_gasPrice` and `eth_estimateGas`; the UI surfaced the RPC error and kept confirmation disabled. This is a mock-provider limitation, not evidence that a real wallet's estimate succeeds. A valid production invoice QR, real browser-wallet signing, and borrow review with a separate funded Testnet wallet remain unverified.

## Live testnet checks

- RPC endpoint: `https://rpc.test.mezo.org`
- Chain ID: `31611` (`0x7b7b`), Mezo Testnet
- Wallet address: `0x2D6d690df41807910826e799A34D7fB418480828`
- Initial native testnet balance: `0.05 BTC`
- Official Mezo developer documentation lists testnet MUSD at `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`; RPC verification confirmed deployed bytecode, `symbol() = MUSD`, and `decimals() = 18`.
- Source: [Mezo testnet MUSD borrowing guide](https://mezo.org/docs/users/borrow/mint-musd/) and the [Mezo Testnet Explorer token page](https://explorer.test.mezo.org/token/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503).
- Live, user-approved test transfer: `0.000001 BTC` sent to the same wallet as a minimal native-transfer smoke test.
- Transaction: [`0xf85a0a3622ddf6456728037b773ba1e26156f9791003c282caca3be8c2d3ed1e`](https://explorer.test.mezo.org/tx/0xf85a0a3622ddf6456728037b773ba1e26156f9791003c282caca3be8c2d3ed1e)
- Receipt: `success`, block `16371393`, gas used `21000`, effective gas price `146` wei; fee `3066000` wei (`0.000000000003066 BTC`).
- RelayGuard independently matched the receipt's asset, recipient, and amount to the stored authorized intent and marked it `confirmed`; the transaction hash persisted with the authorization record.
- User-authorized minimum testnet MUSD loan opened via the official Mezo `BorrowerOperations` deployment: 0.045 BTC collateral and 1,800 MUSD borrowed. The contract charged a 0.1% issuance fee (1.8 MUSD) and added the 200 MUSD gas deposit to composite debt.
- Borrow transaction: [`0x0175798b2aeaf7486d348a3e8194fe61c52570fe8bd8849b235041f39df1ceee`](https://explorer.test.mezo.org/tx/0x0175798b2aeaf7486d348a3e8194fe61c52570fe8bd8849b235041f39df1ceee), successful in block `16372558`; gas used `2676538`; effective gas price `146` wei; fee `390774548` wei (`0.000000000390774548 BTC`).
- Post-receipt RPC verification: wallet received `1800 MUSD`; current trove collateral `0.045 BTC`; current debt `2001.800005074761339434 MUSD`; remaining liquid BTC `0.004999999606159452`; trove status `1` (active).
- At the confirmation block, the oracle-valued collateral was `$3,573.12` against `$2,001.80` debt, for an approximately `178.50%` collateral ratio. The contract's minimum collateral ratio is `110%`; collateral remains exposed to liquidation if the testnet BTC oracle price falls sufficiently or debt accrues.
- After the `1.00 MUSD` invoice payment and `0.001 MUSD` x402 settlement, the buyer held `1798.999 MUSD` and the merchant receiver held `1.001 MUSD`. The merchant receiver received both paths at the same address.
- Local API/UI checks: policy-compliant BTC intent authorized without execution; unallowlisted recipient denied; zero-balance MUSD request rejected before recording authorization; audit chain remained valid.
- Follow-up read-only preflight for the user-connected wallet (address omitted) confirmed Testnet chain ID `31611`, no active trove, `0 MUSD`, and `0.05 BTC` at block `16551183`. Current terms were a `1,800 MUSD` minimum principal, `1.8 MUSD` borrowing fee, `200 MUSD` gas compensation, and `1%` interest. At the observed `$77,673.73379/BTC` PriceFeed, RelayGuard's 200% opening buffer required `0.0515438077 BTC` before gas. The account could not meet that collateral amount; gas estimation returned insufficient balance, and no wallet signature or transaction occurred. Borrow/payment testing for this account remains blocked until it has enough Testnet BTC for collateral plus gas.

## Mezo trove policy evidence

- Each MUSD policy read pins the PriceFeed, trove status, ICR, collateral, and debt calls to one Mezo Testnet block.
- Authorization records retain the block number, observation time, borrower, price, risk tier, ICR, collateral, and debt for request, approval, and execution checks.
- Hash-linked audit events commit the policy digest and the relevant trove-evidence digest. SQLite verification and the Postgres verifier reject record tampering that disagrees with those commitments.
- Automated tests cover healthy/review/below-minimum decisions, review-tier human approval, fail-closed RPC errors, stale-policy rejection/cancellation, and audit evidence tampering.
- Production health currently confirms a healthy trove at the observed block. Live threshold and RPC-failure scenarios have not been induced against the funded production wallet and remain unverified.
