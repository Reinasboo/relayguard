import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { createAdapterRegistry, getAdapter } from "../dist/src/adapters/index.js";

const registry = createAdapterRegistry();

for (const [network, adapter] of registry) {
  test(`${network} advertises only honest capabilities and config requirements`, () => {
    const config = {
      rpcUrl: "https://example.invalid",
      network: network === "bitcoin-lightning" ? "regtest" : "testnet",
      providerUrl: network === "bitcoin-lightning" ? "https://provider.example.invalid" : undefined,
      resourceServerUrl: network === "solana" ? "https://resource.example.invalid" : undefined
    };

    const result = adapter.validateConfiguration(config);
    if (network === "solana") {
      assert.equal(result.valid, true);
    } else {
      assert.equal(result.valid, true);
    }
    assert.ok(Array.isArray(adapter.identity.capabilities));
    assert.ok(adapter.identity.capabilities.length >= 1);
  });
}

test("registry resolves the configured network to the expected adapter", () => {
  assert.ok(getAdapter("mezo"));
  assert.ok(getAdapter("solana"));
  assert.ok(getAdapter("near"));
  assert.ok(getAdapter("bitcoin-lightning"));
  assert.equal(getAdapter("unknown"), undefined);
});

test("adapter operations fail safely when the implementation is not configured", async () => {
  const mezo = getAdapter("mezo");
  assert.ok(mezo);
  const intent = {
    agentId: "agent-1",
    network: "mezo",
    asset: "MUSD",
    recipient: "0xmerchant",
    amountAtomic: "1000",
    purpose: "merchant",
    idempotencyKey: "adapter-1"
  };

  const prepared = await mezo.prepare(intent);
  assert.equal(prepared.supported, false);
  assert.equal(prepared.code, "unsupported_capability");
  const status = await mezo.lookupStatus("abc");
  assert.equal(status.supported, false);
  assert.equal(status.code, "not_configured");
});

test("Mezo prepares only supported positive BTC/MUSD intents on an explicit network", async () => {
  const mezo = getAdapter("mezo");
  assert.ok(mezo);
  const baseIntent = {
    agentId: "agent-1",
    network: "mezo",
    asset: "BTC",
    recipient: "0x2D6d690df41807910826e799A34D7fB418480828",
    amountAtomic: "1",
    purpose: "test",
    idempotencyKey: "mezo-positive"
  };
  const prepared = await mezo.prepare(baseIntent, undefined, {
    rpcUrl: "https://rpc.test.mezo.org",
    network: "testnet"
  });
  assert.equal(prepared.supported, true);
  if (prepared.supported) {
    assert.equal(prepared.value.adapterData.chainId, "31611");
    assert.equal(prepared.value.adapterData.method, "native-transfer");
  }
  assert.equal(
    (await mezo.prepare({ ...baseIntent, asset: "DAI" }, undefined, {
      rpcUrl: "https://rpc.test.mezo.org",
      network: "testnet"
    })).supported,
    false
  );
  assert.equal(
    (await mezo.prepare({ ...baseIntent, amountAtomic: "0" }, undefined, {
      rpcUrl: "https://rpc.test.mezo.org",
      network: "testnet"
    })).supported,
    false
  );
});

test("Mezo refuses a prepared payment whose network payload was changed", async () => {
  const mezo = getAdapter("mezo");
  assert.ok(mezo);
  const intent = {
    agentId: "agent-1",
    network: "mezo",
    asset: "BTC",
    recipient: "0x2D6d690df41807910826e799A34D7fB418480828",
    amountAtomic: "1",
    purpose: "test",
    idempotencyKey: "mezo-payload"
  };
  const prepared = await mezo.prepare(intent, undefined, {
    rpcUrl: "https://rpc.test.mezo.org",
    network: "testnet"
  });
  assert.equal(prepared.supported, true);
  if (!prepared.supported) return;
  const result = await mezo.execute({
    ...prepared.value,
    adapterData: { ...prepared.value.adapterData, chainId: "1" }
  }, undefined, {
    rpcUrl: "https://rpc.test.mezo.org",
    network: "testnet",
    signerPrivateKey: generatePrivateKey()
  });
  assert.equal(result.supported, false);
  if (!result.supported) assert.equal(result.code, "unsupported_capability");
});

test("Mezo verifies MUSD from the exact receipt Transfer event without a transaction lookup", async (t) => {
  const mezo = getAdapter("mezo");
  assert.ok(mezo);
  const tokenAddress = "0x118917a40faf1cd7a13db0ef56c86de7973ac503";
  const payerAddress = "0x2d6d690df41807910826e799a34d7fb418480828";
  const recipientAddress = "0x840e5bbf20d725f581752f8a4021add730550d47";
  const transactionHash = `0x${"a".repeat(64)}`;
  const amount = 1_000_000_000_000_000_000n;
  const topicAddress = (address) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
  const receipt = {
    transactionHash,
    transactionIndex: "0x0",
    blockHash: `0x${"b".repeat(64)}`,
    blockNumber: "0x1",
    from: payerAddress,
    to: tokenAddress,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs: [{
      address: tokenAddress,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        topicAddress(payerAddress),
        topicAddress(recipientAddress)
      ],
      data: `0x${amount.toString(16).padStart(64, "0")}`,
      blockHash: `0x${"b".repeat(64)}`,
      blockNumber: "0x1",
      transactionHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false
    }]
  };
  const methods = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpcRequest = JSON.parse(body);
    methods.push(rpcRequest.method);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: rpcRequest.id,
      result: rpcRequest.method === "eth_getTransactionReceipt" ? receipt : null
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const evidence = await mezo.verifySettlement(transactionHash, undefined, {
    rpcUrl: `http://127.0.0.1:${address.port}`,
    network: "testnet",
    tokenAddress
  });

  assert.equal(evidence.supported, true);
  if (evidence.supported) {
    assert.equal(evidence.value.state, "confirmed");
    assert.equal(evidence.value.asset, "MUSD");
    assert.equal(evidence.value.sender, payerAddress);
    assert.equal(evidence.value.recipient.toLowerCase(), recipientAddress);
    assert.equal(evidence.value.amountAtomic, amount.toString());
  }
  assert.deepEqual(methods, ["eth_getTransactionReceipt"]);
});
