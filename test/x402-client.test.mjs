import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createEip1193Signer, ensurePermit2Allowance } from "../public/x402-client.js";

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

test("x402 signs Permit2 typed data through viem's EIP-1193 serializer", async () => {
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const signingRequests = [];
  const provider = {
    async request(request) {
      if (request.method !== "eth_signTypedData_v4") {
        throw new Error(`Unexpected wallet method: ${request.method}`);
      }
      const [address, serialized] = request.params;
      signingRequests.push({ address, serialized });
      return account.signTypedData(JSON.parse(serialized));
    }
  };
  const typedData = {
    domain: { name: "Permit2", chainId: 31611, verifyingContract: permit2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Witness" }
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      Witness: [
        { name: "to", type: "address" },
        { name: "validAfter", type: "uint256" }
      ]
    },
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token, amount: BigInt(amount) },
      spender: permit2,
      nonce: 1n,
      deadline: 2n,
      witness: { to: payer, validAfter: 0n }
    }
  };
  const signer = createEip1193Signer(provider, account.address);
  const signature = await signer.signTypedData(typedData);
  const rpcData = JSON.parse(signingRequests[0].serialized);
  const recovered = await recoverTypedDataAddress({ ...rpcData, signature });

  assert.equal(signingRequests[0].address, account.address);
  assert.equal(rpcData.primaryType, "PermitWitnessTransferFrom");
  assert.equal(recovered, account.address);
});

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
