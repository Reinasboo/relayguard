import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { CheckoutService } from "../dist/src/core/checkout.js";

const merchant = {
  merchantUserId: "merchant-user-a",
  merchantName: "Test Merchant",
  merchantAddress: "0x2D6d690df41807910826e799A34D7fB418480828",
  amountAtomic: "2500000000000000000",
  description: "Coffee and pastry",
  expiresAt: 2000
};

test("merchant invoices are exact MUSD amounts with constrained lifecycle transitions", () => {
  const checkout = new CheckoutService(":memory:");
  try {
    const invoice = checkout.create({ ...merchant, now: 1000 });
    assert.equal(invoice.asset, "MUSD");
    assert.equal(invoice.status, "open");
    assert.equal(checkout.authorize(invoice.id, "authorization-1", 1100).status, "authorized");
    assert.throws(() => checkout.authorize(invoice.id, "authorization-2", 1200), /cannot be authorized/);
    assert.equal(checkout.release(invoice.id, "authorization-1", 1200).status, "open");
    assert.equal(checkout.authorize(invoice.id, "authorization-2", 1300).authorizationId, "authorization-2");
    assert.equal(
      checkout.submit(invoice.id, "authorization-2", `0x${"a".repeat(64)}`, 1400).status,
      "submitted"
    );
    assert.equal(checkout.settle(invoice.id, "paid").status, "paid");
    assert.throws(() => checkout.settle(invoice.id, "failed"), /cannot settle/);
  } finally {
    checkout.close();
  }
});

test("merchant invoices expire and reject malformed or past-expiry input", () => {
  const checkout = new CheckoutService(":memory:");
  try {
    assert.throws(() => checkout.create({ ...merchant, amountAtomic: "0", now: 1000 }), /Invalid/);
    assert.throws(() => checkout.create({ ...merchant, expiresAt: 1000, now: 1000 }), /Invalid/);
    const invoice = checkout.create({ ...merchant, now: 1000 });
    assert.equal(checkout.get(invoice.id, 2000).status, "expired");
  } finally {
    checkout.close();
  }
});

test("checkout invoices survive database restart and can only be released by their authorization", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "relayguard-checkout-"));
  const databasePath = join(directory, "checkout.sqlite");
  const first = new CheckoutService(databasePath);
  const invoice = first.create({ ...merchant, now: 1000 });
  first.authorize(invoice.id, "authorization-persistent", 1100);
  first.close();

  const restarted = new CheckoutService(databasePath);
  t.after(() => {
    restarted.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(restarted.get(invoice.id, 1200).status, "authorized");
  assert.throws(() => restarted.release(invoice.id, "wrong-authorization", 1200), /matching/);
  assert.equal(restarted.release(invoice.id, "authorization-persistent", 1200).status, "open");
});

test("merchant invoice history is scoped to the authenticated owner", () => {
  const checkout = new CheckoutService(":memory:");
  try {
    const first = checkout.create({ ...merchant, now: 1000 });
    const second = checkout.create({
      ...merchant,
      merchantUserId: "merchant-user-b",
      description: "Different merchant invoice",
      now: 1001
    });
    assert.deepEqual(checkout.list("merchant-user-a").map((invoice) => invoice.id), [first.id]);
    assert.deepEqual(checkout.list("merchant-user-b").map((invoice) => invoice.id), [second.id]);
  } finally {
    checkout.close();
  }
});

test("merchant wallet challenges are scoped, expiring, and consumed once", () => {
  const checkout = new CheckoutService(":memory:");
  try {
    const challenge = {
      id: "c674c6fa-9d6f-4f4f-b0c8-1ad1263b2ed9",
      merchantUserId: "merchant-user-a",
      address: merchant.merchantAddress,
      message: "RelayGuard wallet proof",
      expiresAt: 2000
    };
    checkout.createWalletChallenge(challenge);
    assert.equal(checkout.consumeWalletChallenge("merchant-user-b", challenge.id, 1000), undefined);
    assert.deepEqual(checkout.consumeWalletChallenge("merchant-user-a", challenge.id, 1000), challenge);
    assert.equal(checkout.consumeWalletChallenge("merchant-user-a", challenge.id, 1000), undefined);

    checkout.createWalletChallenge({ ...challenge, id: "a018a86c-81dc-4ad3-880e-6528841e6e2d" });
    assert.equal(
      checkout.consumeWalletChallenge("merchant-user-a", "a018a86c-81dc-4ad3-880e-6528841e6e2d", 2000),
      undefined
    );
  } finally {
    checkout.close();
  }
});

test("merchant x402 resources use verified wallets and scoped, revocable hashed keys", () => {
  const checkout = new CheckoutService(":memory:");
  try {
    assert.throws(() => checkout.createX402Resource({
      merchantUserId: "merchant-user-a",
      name: "Premium response",
      method: "GET",
      routePath: "/api/premium",
      price: "$0.01",
      description: "Premium data",
      keyHash: "0".repeat(64),
      keyPrefix: "rg_test_fixture"
    }), /Verify a merchant receiving wallet/);

    checkout.saveVerifiedWallet("merchant-user-a", "Merchant A", merchant.merchantAddress);
    checkout.saveVerifiedWallet("merchant-user-b", "Merchant B", "0x840E5bBF20D725f581752f8A4021ADd730550d47");
    assert.equal(checkout.updateMerchantName("merchant-user-a", "Cafe A"), true);
    assert.equal(checkout.getMerchantProfile("merchant-user-a").merchantName, "Cafe A");
    assert.equal(checkout.updateMerchantName("unverified-user", "Cafe B"), false);
    assert.throws(() => checkout.updateMerchantName("merchant-user-a", " "), /between 1 and 120/);
    const resource = checkout.createX402Resource({
      merchantUserId: "merchant-user-a",
      name: "Premium response",
      method: "GET",
      routePath: "/api/premium",
      price: "$0.01",
      description: "Premium data",
      keyHash: "0".repeat(64),
      keyPrefix: "rg_test_fixture",
      keyHash: "0".repeat(64),
      keyPrefix: "rg_test_fixture"
    });
    assert.throws(() => checkout.createX402Resource({
      merchantUserId: "merchant-user-a",
      name: "Unsafe route",
      method: "GET",
      routePath: "/api//premium",
      price: "$0.01",
      description: "Premium data",
      keyHash: "0".repeat(64),
      keyPrefix: "rg_test_fixture"
    }), /Invalid/);

    const key = "rg_test_only-for-test";
    const keyHash = createHash("sha256").update(key).digest("hex");
    assert.equal(checkout.rotateX402ApiKey("merchant-user-b", resource.id, keyHash, "wrong-owner"), false);
    assert.equal(checkout.rotateX402ApiKey("merchant-user-a", resource.id, keyHash, "rg_test_only", 1500), true);
    assert.equal(checkout.getX402ResourceByApiKey("wrong-hash"), undefined);
    assert.equal(checkout.getX402ResourceByApiKey(keyHash, 1700).payTo, merchant.merchantAddress);
    assert.equal(checkout.listX402Resources("merchant-user-a")[0].keyPrefix, "rg_test_only");
    assert.equal(checkout.listX402Resources("merchant-user-b").length, 0);

    checkout.revokeX402ApiKey("merchant-user-b", resource.id, 1800);
    assert.ok(checkout.getX402ResourceByApiKey(keyHash));
    checkout.revokeX402ApiKey("merchant-user-a", resource.id, 1900);
    assert.equal(checkout.getX402ResourceByApiKey(keyHash), undefined);
    assert.equal(checkout.deleteX402Resource("merchant-user-b", resource.id), false);
    assert.equal(checkout.deleteX402Resource("merchant-user-a", resource.id), true);
    assert.equal(checkout.listX402Resources("merchant-user-a").length, 0);
  } finally {
    checkout.close();
  }
});
