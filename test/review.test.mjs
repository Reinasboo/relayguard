import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics, encodeAbiParameters, parseAbi } from "viem";
import { previewMezoPolicy, matchesHistoricalTransfer, MUSD_TESTNET, DEMO_PAYER, DEMO_MERCHANT } from "../dist/src/mezo/review.js";

test("reviewer scenarios exercise actual policy rules and spending caps", () => {
  assert.equal(previewMezoPolicy("healthy").outcome, "authorized");
  assert.equal(previewMezoPolicy("review").outcome, "approval_required");
  assert.equal(previewMezoPolicy("blocked").outcome, "blocked");
  assert.equal(previewMezoPolicy("unavailable").outcome, "paused");
  assert.equal(previewMezoPolicy("healthy", "10000000000000000000").outcome, "approval_required");
  assert.equal(previewMezoPolicy("healthy", "26000000000000000000").decision.reason, "transaction_limit_exceeded");
  assert.throws(() => previewMezoPolicy("invented"));
  assert.throws(() => previewMezoPolicy("healthy", "1.5"));
  assert.throws(() => previewMezoPolicy("healthy", "0"));
});

test("Mezo payment evidence checks the token event, including relayed x402 transfers", () => {
  const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const log = { address: MUSD_TESTNET,
    topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: DEMO_PAYER, to: DEMO_MERCHANT } }),
    data: encodeAbiParameters([{ type: "uint256" }], [1000n]) };
  assert.equal(matchesHistoricalTransfer(log, "1000"), true);
  assert.equal(matchesHistoricalTransfer(log, "1001"), false);
  assert.equal(matchesHistoricalTransfer({ ...log, address: DEMO_MERCHANT }, "1000"), false);
  assert.equal(matchesHistoricalTransfer({ ...log, topics: [] }, "1000"), false);
});
