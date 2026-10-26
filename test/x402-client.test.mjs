import assert from "node:assert/strict";
import test from "node:test";
import { ensurePermit2Allowance } from "../public/x402-client.js";

const payer = "0x840E5bBF20D725f581752f8A4021ADd730550d47";
const token = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const amount = "1000000000000000";
const transactionHash = `0x${"1".repeat(64)}`;
const requirements = {
  accepts: [{
    scheme: "exact",
    network: "eip155:31611",
    amount,
    asset: token,
    extra: { assetTransferMethod: "permit2" }
  }]
};

test("x402 requests only the exact MUSD Permit2 allowance and verifies confirmation", async () => {
  const calls = [];
  let allowanceReads = 0;
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_call") {
        allowanceReads += 1;
        return allowanceReads === 1 ? "0x0" : `0x${BigInt(amount).toString(16)}`;
      }
      if (request.method === "eth_sendTransaction") {
        return transactionHash;
      }
      if (request.method === "eth_getTransactionReceipt") {
        return { status: "0x1" };
      }
      throw new Error(`Unexpected wallet method: ${request.method}`);
    }
  };
  const progress = [];

  await ensurePermit2Allowance(provider, payer, requirements, (message) => progress.push(message));

  const approval = calls.find((request) => request.method === "eth_sendTransaction").params[0];
  assert.equal(approval.to, token);
  assert.equal(approval.from, payer);
  assert.equal(
    approval.data,
    `0x095ea7b3${permit2.slice(2).toLowerCase().padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`
  );
  assert.equal(calls.filter((request) => request.method === "eth_call").length, 2);
  assert.ok(progress.some((message) => message.includes("exactly 0.001 MUSD")));
});

test("x402 skips Permit2 approval when the existing allowance covers the charge", async () => {
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_call") {
        return `0x${BigInt(amount).toString(16)}`;
      }
      throw new Error(`Unexpected wallet method: ${request.method}`);
    }
  };

  await ensurePermit2Allowance(provider, payer, requirements, () => undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "eth_call");
});
