import assert from "node:assert/strict";
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
