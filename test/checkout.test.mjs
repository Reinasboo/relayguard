import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
