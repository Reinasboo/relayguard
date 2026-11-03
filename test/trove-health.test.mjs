import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTroveRisk,
  applyMezoTrovePolicy,
  readMezoTroveHealth,
  TROVE_MINIMUM_ICR,
  TROVE_REVIEW_ICR
} from "../dist/src/mezo/trove-health.js";
import { evaluatePolicy } from "../dist/src/core/policy.js";
import { AuthorizationService } from "../dist/src/index.js";

const borrower = "0x840E5bBF20D725f581752f8A4021ADd730550d47";

test("trove risk uses Mezo's minimum ratio and RelayGuard's review buffer", () => {
  assert.equal(classifyTroveRisk(0), "inactive");
  assert.equal(classifyTroveRisk(1, (TROVE_MINIMUM_ICR - 1n).toString()), "below_minimum");
  assert.equal(classifyTroveRisk(1, TROVE_MINIMUM_ICR.toString()), "review_required");
  assert.equal(classifyTroveRisk(1, (TROVE_REVIEW_ICR - 1n).toString()), "review_required");
  assert.equal(classifyTroveRisk(1, TROVE_REVIEW_ICR.toString()), "healthy");
});

test("active trove reads use the live Mezo price for protocol ICR", async () => {
  const calls = [];
  const client = {
    async getBlockNumber() { return 100n; },
    async getBlock({ blockNumber }) {
      assert.equal(blockNumber, 100n);
      return { timestamp: 1234n };
    },
    async readContract(request) {
      calls.push(request);
      assert.equal(request.blockNumber, 100n);
      switch (request.functionName) {
        case "fetchPrice": return 2_000n * 10n ** 18n;
        case "getTroveStatus": return 1;
        case "getCurrentICR": return 1_490_000_000_000_000_000n;
        case "getTroveColl": return 45_000_000_000_000_000n;
        case "getTroveDebt": return 2_001_800_000_000_000_000_000n;
        default: throw new Error(`Unexpected contract read: ${request.functionName}`);
      }
    }
  };
  const health = await readMezoTroveHealth(client, borrower);

  assert.equal(health.status, "active");
  assert.equal(health.risk, "review_required");
  assert.equal(health.icrAtomic, "1490000000000000000");
  assert.equal(health.collateralAtomic, "45000000000000000");
  assert.equal(health.debtAtomic, "2001800000000000000000");
  assert.equal(health.observedAt, 1_234_000);
  assert.equal(health.blockNumber, "100");
  assert.equal(health.priceAtomic, (2_000n * 10n ** 18n).toString());
  const icrCall = calls.find((call) => call.functionName === "getCurrentICR");
  assert.equal(icrCall.args[1], 2_000n * 10n ** 18n);
});

test("inactive troves do not trigger collateral or debt reads", async () => {
  const names = [];
  const health = await readMezoTroveHealth({
    async getBlockNumber() { return 101n; },
    async getBlock() { return { timestamp: 1235n }; },
    async readContract({ functionName }) {
      names.push(functionName);
      return functionName === "fetchPrice" ? 2_000n * 10n ** 18n : 0n;
    }
  }, borrower);

  assert.equal(health.status, "inactive");
  assert.equal(health.risk, "inactive");
  assert.equal(health.status, "inactive");
  assert.deepEqual(names.sort(), ["fetchPrice", "getTroveStatus"]);
});

test("review-tier troves require human approval; below-minimum MUSD is denied", async () => {
  const basePolicy = {
    id: "musd-policy",
    version: 1,
    agentId: "agent-1",
    network: "mezo",
    asset: "MUSD",
    maxTransactionAtomic: "1000",
    dailyLimitAtomic: "2000",
    approvalThresholdAtomic: "500",
    allowedRecipients: ["merchant-wallet"],
    approverIds: ["human-1"]
  };
  const intent = {
    agentId: "agent-1",
    network: "mezo",
    asset: "MUSD",
    recipient: "merchant-wallet",
    amountAtomic: "10",
    purpose: "resource-access",
    idempotencyKey: "trove-aware"
  };
  const review = applyMezoTrovePolicy(basePolicy, "review_required");
  assert.equal(review.approvalThresholdAtomic, "1");
  assert.deepEqual(evaluatePolicy(intent, review, { now: 1, spentTodayAtomic: 0n }), {
    outcome: "allow",
    requiresApproval: true
  });
  assert.deepEqual(
    evaluatePolicy(intent, applyMezoTrovePolicy(basePolicy, "below_minimum"), {
      now: 1,
      spentTodayAtomic: 0n
    }),
    { outcome: "deny", reason: "mezo_trove_below_minimum" }
  );
  const service = new AuthorizationService();
  const blocked = service.request(
    { ...intent, idempotencyKey: "below-minimum-service" },
    applyMezoTrovePolicy(basePolicy, "below_minimum"),
    1,
    {
      protocol: "mezo-musd-trove",
      borrower,
      chainId: 31611,
      blockNumber: "102",
      observedAt: 1236000,
      status: "active",
      risk: "below_minimum",
      priceAtomic: "2000000000000000000000",
      collateralAtomic: "1",
      debtAtomic: "1000",
      icrAtomic: (TROVE_MINIMUM_ICR - 1n).toString()
    }
  );
  assert.equal(blocked.record.status, "denied");
  assert.equal(blocked.record.reason, "mezo_trove_below_minimum");
  assert.equal(blocked.record.mezoTroveEvidence[0].blockNumber, "102");
});

test("invalid protocol ratios and RPC failures are surfaced", async () => {
  assert.throws(() => classifyTroveRisk(1, "1.5"), /invalid active-trove collateral ratio/);
  await assert.rejects(
    readMezoTroveHealth({
      getBlockNumber: async () => 1n,
      getBlock: async () => ({ timestamp: 1n }),
      readContract: async () => { throw new Error("RPC unavailable"); }
    }, borrower),
    /RPC unavailable/
  );
});
