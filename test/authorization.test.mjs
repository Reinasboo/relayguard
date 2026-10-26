import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthorizationService,
  evaluatePolicy
} from "../dist/src/index.js";

const policy = {
  id: "policy-agent-1",
  version: 1,
  agentId: "agent-1",
  network: "solana",
  asset: "USDC",
  maxTransactionAtomic: "1000",
  dailyLimitAtomic: "1500",
  approvalThresholdAtomic: "500",
  allowedRecipients: ["merchant-wallet"],
  approverIds: ["human-1"]
};

function intent(overrides = {}) {
  return {
    agentId: "agent-1",
    network: "solana",
    asset: "USDC",
    recipient: "merchant-wallet",
    amountAtomic: "100",
    purpose: "resource-access",
    idempotencyKey: "request-1",
    ...overrides
  };
}

test("policy allows valid amounts and requires approval at the threshold", () => {
  assert.deepEqual(evaluatePolicy(intent(), policy, { now: 10, spentTodayAtomic: 0n }), {
    outcome: "allow",
    requiresApproval: false
  });
  assert.deepEqual(
    evaluatePolicy(intent({ amountAtomic: "500" }), policy, {
      now: 10,
      spentTodayAtomic: 0n
    }),
    { outcome: "allow", requiresApproval: true }
  );
});

test("policy denies malformed amounts, unauthorized recipients, and limit overruns", () => {
  assert.equal(
    evaluatePolicy(intent({ amountAtomic: "1.2" }), policy, {
      now: 10,
      spentTodayAtomic: 0n
    }).outcome,
    "deny"
  );
  assert.deepEqual(
    evaluatePolicy(intent({ recipient: "unapproved" }), policy, {
      now: 10,
      spentTodayAtomic: 0n
    }),
    { outcome: "deny", reason: "recipient_not_allowed" }
  );
  assert.deepEqual(
    evaluatePolicy(intent({ amountAtomic: "1001" }), policy, {
      now: 10,
      spentTodayAtomic: 0n
    }),
    { outcome: "deny", reason: "transaction_limit_exceeded" }
  );
  assert.deepEqual(
    evaluatePolicy(intent({ amountAtomic: "600" }), policy, {
      now: 10,
      spentTodayAtomic: 1000n
    }),
    { outcome: "deny", reason: "daily_limit_exceeded" }
  );
});

test("pending approvals reserve the daily limit before another request is authorized", () => {
  const service = new AuthorizationService();
  const limitedPolicy = { ...policy, dailyLimitAtomic: "600" };
  const first = service.request(
    intent({ amountAtomic: "500", idempotencyKey: "first" }),
    limitedPolicy,
    Date.UTC(2026, 0, 1, 12)
  );
  const second = service.request(
    intent({ amountAtomic: "200", idempotencyKey: "second" }),
    limitedPolicy,
    Date.UTC(2026, 0, 1, 12, 1)
  );
  assert.equal(first.record.status, "awaiting_approval");
  assert.equal(second.record.status, "denied");
  assert.equal(second.record.reason, "daily_limit_exceeded");
});

test("approval policies without an eligible human approver fail closed", () => {
  const decision = evaluatePolicy(
    intent({ amountAtomic: "500" }),
    { ...policy, approverIds: [] },
    { now: 10, spentTodayAtomic: 0n }
  );
  assert.deepEqual(decision, { outcome: "deny", reason: "invalid_policy" });
});

test("invalid timestamps are rejected without corrupting the ledger", () => {
  const service = new AuthorizationService();
  assert.throws(() => service.request(intent(), policy, Number.NaN), /finite number/);
  const valid = service.request(intent(), policy, 100);
  assert.equal(valid.record.status, "authorized");
});

test("idempotency returns the original decision and rejects changed intent", () => {
  const service = new AuthorizationService();
  const first = service.request(intent(), policy, 100);
  const replay = service.request(intent(), policy, 101);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, first.record.id);
  assert.throws(
    () => service.request(intent({ amountAtomic: "101" }), policy, 102),
    /different transaction intent/
  );
});

test("approval challenge is bound to the policy, approver, and exact request", () => {
  const service = new AuthorizationService();
  const result = service.request(intent({ amountAtomic: "500" }), policy, 100);
  assert.equal(result.record.status, "awaiting_approval");
  assert.ok(result.approvalChallenge);
  assert.throws(
    () => service.approve(result.record.id, "intruder", result.approvalChallenge, policy, 101),
    /not authorized/
  );
  assert.throws(
    () =>
      service.approve(
        result.record.id,
        "human-1",
        result.approvalChallenge,
        { ...policy, version: 2 },
        101
      ),
    /policy has changed/
  );
  const approved = service.approve(
    result.record.id,
    "human-1",
    result.approvalChallenge,
    policy,
    101
  );
  assert.equal(approved.status, "authorized");
  assert.throws(
    () => service.approve(result.record.id, "human-1", result.approvalChallenge, policy, 102),
    /state 'authorized'/
  );
});

test("expired approvals fail closed and cannot be reused", () => {
  const service = new AuthorizationService();
  const result = service.request(intent({ amountAtomic: "500" }), policy, 100);
  assert.ok(result.approvalChallenge);
  assert.throws(
    () =>
      service.approve(
        result.record.id,
        "human-1",
        result.approvalChallenge,
        policy,
        100 + 10 * 60 * 1000
      ),
    /expired/
  );
  assert.equal(service.get(result.record.id).status, "expired");
});

test("state transitions are constrained and the audit hash chain verifies", () => {
  const service = new AuthorizationService();
  const result = service.request(intent(), policy, 100);
  assert.equal(result.record.status, "authorized");
  assert.equal(service.markExecuting(result.record.id, 101).status, "executing");
  const hash = `0x${"a".repeat(64)}`;
  const submitted = service.markSubmitted(result.record.id, 102, hash);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.transactionReference, hash);
  assert.equal(service.markConfirmed(result.record.id, 103).status, "confirmed");
  assert.throws(() => service.markFailed(result.record.id, "late failure", 104), /Invalid/);
  assert.equal(service.verifyAuditChain(), true);
  assert.equal(service.auditEvents().length, 4);
});

test("authorization records and audit events survive a database restart", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "relayguard-persistence-"));
  const databasePath = join(directory, "relayguard.sqlite");
  const firstService = new AuthorizationService(databasePath);
  const first = firstService.request(intent(), policy, 100);
  firstService.close();

  const restartedService = new AuthorizationService(databasePath);
  t.after(() => {
    restartedService.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(restartedService.get(first.record.id).status, "authorized");
  assert.equal(restartedService.request(intent(), policy, 101).replayed, true);
  assert.equal(restartedService.auditEvents().length, 1);
  assert.equal(restartedService.verifyAuditChain(), true);
});

test("separate SQLite connections atomically reserve shared daily spending", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "relayguard-concurrency-"));
  const databasePath = join(directory, "relayguard.sqlite");
  const firstService = new AuthorizationService(databasePath);
  const secondService = new AuthorizationService(databasePath);
  const limitedPolicy = { ...policy, dailyLimitAtomic: "600" };

  t.after(() => {
    firstService.close();
    secondService.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const first = firstService.request(
    intent({ amountAtomic: "500", idempotencyKey: "connection-a" }),
    limitedPolicy,
    Date.UTC(2026, 0, 1, 12)
  );
  const second = secondService.request(
    intent({ amountAtomic: "200", idempotencyKey: "connection-b" }),
    limitedPolicy,
    Date.UTC(2026, 0, 1, 12, 1)
  );
  assert.equal(first.record.status, "awaiting_approval");
  assert.equal(second.record.status, "denied");
  assert.equal(second.record.reason, "daily_limit_exceeded");
});

test("database startup refuses a tampered audit chain", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "relayguard-audit-"));
  const databasePath = join(directory, "relayguard.sqlite");
  const service = new AuthorizationService(databasePath);
  service.request(intent(), policy, 100);
  service.close();

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("UPDATE audit_events SET hash = 'tampered' WHERE sequence = 1");
  database.close();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () => new AuthorizationService(databasePath),
    /audit chain is invalid/
  );
});
