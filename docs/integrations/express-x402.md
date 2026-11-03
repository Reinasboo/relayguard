# Accept MUSD payments on your API with RelayGuard

RelayGuard merchants can protect an endpoint in their own Express API. Buyers
pay the exact MUSD amount through x402; successful settlement sends MUSD
directly to the merchant's verified Mezo Testnet wallet before the route
returns its protected response.

RelayGuard manages the merchant's verified destination, resource settings, and
revocable API key. Settlement is performed by the configured x402 facilitator
(Vativ in the current demo), not by a RelayGuard custody wallet. RelayGuard
never needs the merchant's private key.

## 1. Verify a receiving wallet

Sign in to the RelayGuard merchant workspace, set the store name customers
should see, and choose **Connect & verify**.
Connect a wallet on Mezo Testnet and sign the one-time ownership message. This
is a signature, not a transaction. The wallet address becomes the direct MUSD
recipient for invoices and x402 resources.

## 2. Register the product route

In **Your product · x402**, enter the HTTP method, exact route path, MUSD price,
resource name, and a short description. Create the integration. RelayGuard
shows a merchant API key once; save it as a server-side secret. The key is
scoped to that resource. It can be rotated or revoked from the workspace.

Do not put the merchant API key in browser code, mobile apps, or public source
control. End users do not need this key; their x402 client pays the challenge
returned by your API.

## 3. Add the Express adapter

Use Node.js 22+ and install the x402 server dependencies in your API project:

```sh
npm install @x402/core @x402/evm @x402/express
```

Copy [`src/x402/express.ts`](../../src/x402/express.ts) from this repository
into your TypeScript project as `relayguard-express.ts`. Set the key only in
your API server environment:

```text
RELAYGUARD_API_KEY=rg_test_...
```

Register the middleware before your route handlers. The route and method must
match the resource you registered in RelayGuard:

```ts
import express from "express";
import { createRelayGuardX402Middleware } from "./relayguard-express.js";

const app = express();

app.use(await createRelayGuardX402Middleware({
  apiKey: process.env.RELAYGUARD_API_KEY!
}));

app.get("/api/premium", (_request, response) => {
  response.json({ data: "Your protected product response" });
});
```

The adapter checks the resource configuration during startup and revalidates
the API key, price, and receiving wallet when a protected request is made.
Revoking or rotating a key therefore disables the old credential; restarting
your API is not required for that key check.

## Payment and operational notes

- The current integration is **Mezo Testnet only** (`eip155:31611`) and uses
  MUSD. Do not use it to collect mainnet funds.
- The buyer signs the x402 payment authorization. If needed, a separate exact
  Permit2 approval is signed by the buyer and uses BTC for gas.
- The configured facilitator verifies and settles the MUSD payment. Confirmed
  settlement is required before the Express handler returns the protected
  response.
- RelayGuard's API key is for server-to-server resource configuration. It is
  not a wallet key and cannot spend MUSD.
- Keep your resource handler idempotent where practical. A payment can settle
  even if your application fails while generating its response; log settlement
  references and make retries safe.
