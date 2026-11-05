import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

test("HTTP boundaries and checkout retry/recovery use real stores with mocked external services", async (t) => {
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  Object.assign(process.env, { NODE_ENV: "test", RELAYGUARD_NO_LISTEN: "true", RELAYGUARD_DATABASE_PATH: ":memory:",
    MEZO_PRIVATE_KEY: `0x${"1".repeat(64)}`, MEZO_SIGNER_ADDRESS: account.address,
    MEZO_MERCHANT_ADDRESS: account.address, MEZO_ALLOWED_RECIPIENTS: account.address,
    MEZO_TOKEN_ADDRESS: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503", MEZO_NETWORK: "testnet",
    SUPABASE_URL: "https://auth.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-key",
    RELAYGUARD_OPERATOR_USER_IDS: "operator-user", X402_ENABLED: "false", MEZO_RPC_URL: "https://rpc.invalid" });
  delete process.env.DATABASE_URL; delete process.env.VERCEL;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://auth.invalid")) {
      const token = new Headers(init?.headers).get("authorization");
      if (!["Bearer merchant", "Bearer operator"].includes(token)) return Response.json({ msg: "Invalid token" }, { status: 401 });
      return Response.json({ id: token === "Bearer operator" ? "operator-user" : "merchant-user", aud: "authenticated", role: "authenticated" });
    }
    if (url.startsWith("https://rpc.invalid")) {
      const message = JSON.parse(init.body);
      const handle = (request) => {
        let result;
        if (request.method === "eth_call") {
          const data = request.params[0].data;
          result = data.startsWith("0x95d89b41") ? encodeAbiParameters([{ type: "string" }], ["MUSD"])
            : data.startsWith("0x313ce567") ? encodeAbiParameters([{ type: "uint8" }], [18])
            : encodeAbiParameters([{ type: "uint256" }], [1000n * 10n ** 18n]);
        } else if (request.method === "eth_getTransactionByHash") result = {
          hash: request.params[0], from: account.address, to: process.env.MEZO_TOKEN_ADDRESS,
          input: '0xa9059cbb' + account.address.slice(2).toLowerCase().padStart(64,'0') + (10n**18n).toString(16).padStart(64,'0'),
          value: '0x0', gas: '0x10000', nonce: '0x0', type: '0x2', blockHash: null, blockNumber: null, transactionIndex: null
        }; else if (request.method === "eth_getTransactionReceipt") result = null;
        else throw new Error(`Unexpected mock RPC: ${request.method}`);
        return { jsonrpc: "2.0", id: request.id, result };
      };
      return Response.json(Array.isArray(message) ? message.map(handle) : handle(message));
    }
    return originalFetch(input, init);
  };
  const { default: app } = await import("../dist/src/server.js");
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { globalThis.fetch = originalFetch; await new Promise((resolve) => server.close(resolve)); });
  async function call(path, body, token) {
    const response = await originalFetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  await t.test("all browser imports and the review page are served locally", async () => {
    for (const path of ["/", "/wallet-provider.js", "/review", "/review.js", "/review.css"]) {
      const response = await originalFetch(`${base}${path}`); assert.equal(response.status, 200, path);
    }
  });
  await t.test("merchant authentication grants no treasury permission", async () => {
    assert.equal((await call("/api/audit")).status, 401);
    assert.equal((await call("/api/audit", undefined, "merchant")).status, 403);
    assert.equal((await call("/api/payments", { asset: "BTC" }, "merchant")).status, 403);
    assert.equal((await call("/api/audit", undefined, "operator")).status, 200);
    assert.deepEqual((await call("/api/session", undefined, "merchant")).body, { authenticated: true, operator: false });
  });
  await t.test("public policy scenarios do not require account or wallet", async () => {
    for (const [scenario, outcome] of [["healthy", "authorized"], ["review", "approval_required"], ["blocked", "blocked"], ["unavailable", "paused"]]) {
      assert.equal((await call("/api/mezo/policy-preview", { scenario })).body.outcome, outcome);
    }
    assert.equal((await call("/api/mezo/policy-preview", { scenario: "fake" })).status, 400);
  });
  const walletProof = (await call("/api/merchant/wallet/challenge", { address: account.address }, "merchant")).body;
  assert.equal((await call("/api/merchant/wallet/verify", { challengeId: walletProof.challengeId,
    signature: await account.signMessage({ message: walletProof.message }) }, "merchant")).status, 200);
  const invoice = (await call("/api/invoices", { amount: "1.00", description: "Fixture digital order" }, "merchant")).body.invoice;
  await t.test("invoice amounts reject precision loss rather than rounding the charge", async () => {
    assert.equal((await call("/api/invoices", { amount: "1.0000000000000000001", description: "Too precise" }, "merchant")).status, 400);
    assert.equal((await call("/api/invoices", { amount: "1e2", description: "Exponent" }, "merchant")).status, 400);
  });
  async function authorize() {
    const proof = (await call(`/api/invoices/${invoice.id}/challenge`, { payerAddress: account.address })).body;
    return call(`/api/invoices/${invoice.id}/authorize`, { payerAddress: account.address, challenge: proof.challenge,
      signature: await account.signMessage({ message: proof.message }) });
  }
  let first;
  await t.test("an address alone cannot reserve or release a buyer invoice", async () => {
    assert.equal((await call(`/api/invoices/${invoice.id}/authorize`, { payerAddress: account.address })).status, 403);
    first = (await authorize()).body;
    assert.equal(first.invoice.status, "authorized");
    assert.equal((await call(`/api/invoices/${invoice.id}/release`, { authorizationId: first.authorization.id, payerAddress: account.address })).status, 403);
  });
  await t.test("wallet rejection releases its reservation and the same payer can retry", async () => {
    const release = { authorizationId: first.authorization.id, payerAddress: account.address, checkoutToken: first.checkoutToken };
    assert.equal((await call(`/api/invoices/${invoice.id}/release`, release)).body.invoice.status, "open");
    assert.equal((await call(`/api/invoices/${invoice.id}/release`, release)).status, 200);
    const retry = await authorize(); assert.equal(retry.status, 200);
    assert.notEqual(retry.body.authorization.id, first.authorization.id);
    first = retry.body;
  });
  await t.test("submission needs a capability and safely replays the same broadcast hash", async () => {
    const submit = { authorizationId: first.authorization.id, transactionHash: `0x${"a".repeat(64)}` };
    assert.equal((await call(`/api/invoices/${invoice.id}/submit`, submit)).status, 403);
    const result = await call(`/api/invoices/${invoice.id}/submit`, { ...submit, checkoutToken: first.checkoutToken });
    assert.equal(result.body.invoice.status, "submitted"); assert.equal(result.body.authorization.status, "submitted");
    assert.equal((await call(`/api/invoices/${invoice.id}/submit`, { ...submit, checkoutToken: first.checkoutToken })).status, 200);
    assert.equal((await call(`/api/invoices/${invoice.id}/verify`, {})).status, 202);
  });
});
