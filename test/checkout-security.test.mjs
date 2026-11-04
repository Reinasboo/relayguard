import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { CheckoutSecurity } from "../dist/src/core/checkout-security.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
const security = new CheckoutSecurity("test-secret-with-at-least-thirty-two-characters");

test("checkout wallet proof binds invoice, payer, expiry and retry attempt", async () => {
  const first = security.challenge("invoice-a", account.address, 1000);
  const signature = await account.signMessage({ message: first.message });
  const attempt = await security.verify(first.challenge, signature, "invoice-a", account.address, 1001);
  assert.ok(attempt);
  await assert.rejects(security.verify(first.challenge, signature, "invoice-b", account.address, 1001));
  await assert.rejects(security.verify(first.challenge, signature, "invoice-a", other.address, 1001));
  await assert.rejects(security.verify(first.challenge, signature, "invoice-a", account.address, first.expiresAt));
  const second = security.challenge("invoice-a", account.address, 1002);
  const next = await security.verify(second.challenge, await account.signMessage({ message: second.message }), "invoice-a", account.address, 1003);
  assert.notEqual(attempt, next);
});

test("checkout sessions resist forgery, cross-invoice use and challenge/session substitution", () => {
  const session = security.session("invoice-a", account.address, "authorization-a", 5000);
  assert.equal(security.requireSession(session, "invoice-a", "authorization-a", 1000), account.address);
  assert.throws(() => security.requireSession(session, "invoice-b", "authorization-a", 1000));
  assert.throws(() => security.requireSession(session, "invoice-a", "authorization-b", 1000));
  assert.throws(() => security.requireSession(session, "invoice-a", "authorization-a", 5000));
  assert.throws(() => security.requireSession(`${session.slice(0, -4)}xxxx`, "invoice-a", "authorization-a", 1000));
  const challenge = security.challenge("invoice-a", account.address, 1000);
  assert.throws(() => security.requireSession(challenge.challenge, "invoice-a", "authorization-a", 1001));
});
