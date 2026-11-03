import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTroveRisk,
  readMezoTroveHealth,
  TROVE_MINIMUM_ICR,
  TROVE_REVIEW_ICR
} from "../dist/src/mezo/trove-health.js";

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
    async readContract(request) {
      calls.push(request);
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
  const health = await readMezoTroveHealth(client, borrower, 1234);

  assert.equal(health.status, "active");
  assert.equal(health.risk, "review_required");
  assert.equal(health.icrAtomic, "1490000000000000000");
  assert.equal(health.collateralAtomic, "45000000000000000");
  assert.equal(health.debtAtomic, "2001800000000000000000");
  assert.equal(health.observedAt, 1234);
  const icrCall = calls.find((call) => call.functionName === "getCurrentICR");
  assert.equal(icrCall.args[1], 2_000n * 10n ** 18n);
});

test("inactive troves do not trigger collateral or debt reads", async () => {
  const names = [];
  const health = await readMezoTroveHealth({
    async readContract({ functionName }) {
      names.push(functionName);
      return functionName === "fetchPrice" ? 2_000n * 10n ** 18n : 0n;
    }
  }, borrower);

  assert.equal(health.status, "inactive");
  assert.equal(health.risk, "inactive");
  assert.deepEqual(names.sort(), ["fetchPrice", "getTroveStatus"]);
});

test("invalid protocol ratios and RPC failures are surfaced", async () => {
  assert.throws(() => classifyTroveRisk(1, "1.5"), /invalid active-trove collateral ratio/);
  await assert.rejects(
    readMezoTroveHealth({ readContract: async () => { throw new Error("RPC unavailable"); } }, borrower),
    /RPC unavailable/
  );
});
