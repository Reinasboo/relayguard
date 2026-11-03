import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createRelayGuardX402Middleware } from "../dist/src/x402/express.js";

const apiKey = `rg_test_${"a".repeat(43)}`;
const config = {
  resource: {
    name: "Premium API",
    method: "GET",
    routePath: "/api/premium",
    price: "$0.01",
    description: "Premium data",
    payTo: "0x840E5bBF20D725f581752f8A4021ADd730550d47"
  },
  network: "eip155:31611",
  facilitatorUrl: "https://facilitator.vativ.io",
  testnet: true
};

test("merchant Express middleware loads only its RelayGuard resource configuration", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestHeaders;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://relayguard.vercel.app/api/sdk/x402-config") {
      requestUrl = url;
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(config), { status: 200 });
    }
    return new Response(JSON.stringify({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:31611" }]
    }), { status: 200 });
  };
  try {
    const middleware = await createRelayGuardX402Middleware({ apiKey });
    assert.equal(typeof middleware, "function");
    assert.equal(requestUrl, "https://relayguard.vercel.app/api/sdk/x402-config");
    assert.equal(requestHeaders.get("authorization"), `Bearer ${apiKey}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merchant Express middleware rejects malformed keys and untrusted configuration", async () => {
  await assert.rejects(
    createRelayGuardX402Middleware({ apiKey: "not-an-api-key" }),
    /valid RelayGuard merchant API key/
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...config,
    resource: { ...config.resource, payTo: "not-an-address" }
  }), { status: 200 });
  try {
    await assert.rejects(createRelayGuardX402Middleware({ apiKey }), /invalid x402 integration configuration/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merchant Express adapter returns an exact Mezo MUSD 402 challenge for its own route", async (t) => {
  const originalFetch = globalThis.fetch;
  let configurationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
    if (url === "https://relayguard.vercel.app/api/sdk/x402-config") {
      configurationCalls += 1;
      const current = configurationCalls === 1
        ? config
        : { ...config, resource: { ...config.resource, price: "$0.02" } };
      return new Response(JSON.stringify(current), { status: 200 });
    }
    return new Response(JSON.stringify({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:31611" }]
    }), { status: 200 });
  };
  const app = express();
  app.use(await createRelayGuardX402Middleware({ apiKey }));
  app.get("/api/premium", (_request, response) => response.json({ data: "protected" }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    globalThis.fetch = originalFetch;
    server.close();
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await originalFetch(`http://127.0.0.1:${address.port}/api/premium`, {
    headers: { accept: "application/json" }
  });
  assert.equal(response.status, 402);
  const requiredHeader = response.headers.get("payment-required");
  assert.ok(requiredHeader);
  const challenge = JSON.parse(Buffer.from(requiredHeader, "base64").toString("utf8"));
  assert.ok(challenge.accepts.some((requirement) =>
    requirement.network === "eip155:31611" &&
    requirement.asset === "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" &&
    requirement.amount === "20000000000000000" &&
    requirement.payTo === config.resource.payTo
  ));
  assert.ok(configurationCalls >= 3);
});
