import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationService } from "../dist/src/core/authorization.js";
import { CheckoutService } from "../dist/src/core/checkout.js";
import { reconcileInvoiceSubmission } from "../dist/src/core/checkout-recovery.js";

function fixture() {
  const authorization = new AuthorizationService();
  const checkout = new CheckoutService(":memory:");
  const recipient = "0x840E5bBF20D725f581752f8A4021ADd730550d47";
  const intent = { agentId: "checkout:fixture", network: "mezo", asset: "MUSD", recipient,
    amountAtomic: "100", purpose: "Recovery proof", idempotencyKey: "recovery" };
  const policy = { id: "checkout", version: 1, agentId: intent.agentId, network: "mezo", asset: "MUSD",
    maxTransactionAtomic: "1000", dailyLimitAtomic: "2000", allowedRecipients: [recipient], approverIds: [] };
  const record = authorization.request(intent, policy).record;
  const created = checkout.create({ merchantUserId: "merchant", merchantName: "Fixture", merchantAddress: recipient,
    amountAtomic: "100", description: "Recovery proof", expiresAt: Date.now()+60_000 });
  checkout.authorize(created.id, record.id);
  const invoice = checkout.submit(created.id, record.id, `0x${"a".repeat(64)}`);
  return { authorization, checkout, record, invoice };
}

test("a crash after invoice submission can resume the authorization without another payment", async () => {
  const { authorization, checkout, record, invoice } = fixture();
  try {
    assert.equal(authorization.get(record.id).status, "authorized");
    await reconcileInvoiceSubmission(invoice, authorization);
    assert.equal(authorization.get(record.id).status, "submitted");
    assert.equal(authorization.get(record.id).transactionReference, invoice.transactionReference);
    const events = authorization.auditEvents().length;
    await reconcileInvoiceSubmission(invoice, authorization);
    assert.equal(authorization.auditEvents().length, events, "Replaying recovery must not append duplicate transitions");
    assert.equal(authorization.verifyAuditChain(), true);
  } finally { authorization.close(); checkout.close(); }
});

test("recovery refuses a mismatched intent or an already bound different transaction", async () => {
  const { authorization, checkout, record, invoice } = fixture();
  try {
    await assert.rejects(reconcileInvoiceSubmission({ ...invoice, amountAtomic: "101" }, authorization), /does not match/);
    assert.equal(authorization.get(record.id).status, "authorized");
    authorization.markExecuting(record.id);
    authorization.markSubmitted(record.id, Date.now(), `0x${"b".repeat(64)}`);
    await assert.rejects(reconcileInvoiceSubmission(invoice, authorization), /does not match/);
    assert.equal(authorization.get(record.id).transactionReference, `0x${"b".repeat(64)}`);
  } finally { authorization.close(); checkout.close(); }
});
