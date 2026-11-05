import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionResult, parseAbi, toFunctionSelector } from "viem";
import {
  classifyTroveRisk,
  applyMezoTrovePolicy,
  readMezoTroveHealth,
  TROVE_MINIMUM_ICR,
  TROVE_REVIEW_ICR
} from "../dist/src/mezo/trove-health.js";
import {
  calculateTroveIcr,
  getTroveFundingError,
  openMezoTestnetTrove,
  minimumCollateralForIcr,
  quoteMezoTroveOpen,
  MEZO_TESTNET_BORROWER_OPERATIONS,
  TROVE_OPENING_TARGET_ICR
} from "../dist/src/mezo/checkout-client.js";
import { evaluatePolicy } from "../dist/src/core/policy.js";
import { AuthorizationService } from "../dist/src/index.js";

const borrower = "0x840E5bBF20D725f581752f8A4021ADd730550d47";
const interestRateManager = "0x1111111111111111111111111111111111111111";
const governableVariables = "0x2222222222222222222222222222222222222222";
const borrowTransactionHash = `0x${"a".repeat(64)}`;

function createBorrowFlowProvider({ nativeBalance = 100n * 10n ** 15n } = {}) {
  const borrowerOperationsAbi = parseAbi([
    "function minNetDebt() view returns (uint256)",
    "function getBorrowingFee(uint256 _debt) view returns (uint256)",
    "function interestRateManager() view returns (address)",
    "function governableVariables() view returns (address)"
  ]);
  const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);
  const troveManagerAbi = parseAbi(["function getTroveStatus(address borrower) view returns (uint8)"]);
  const governableVariablesAbi = parseAbi(["function isAccountFeeExempt(address account) view returns (bool)"]);
  const interestRateManagerAbi = parseAbi(["function interestRate() view returns (uint16)"]);
  const musdAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
  const functions = new Map([
    [toFunctionSelector("fetchPrice()"), [priceFeedAbi, "fetchPrice", 80_000n * 10n ** 18n]],
    [toFunctionSelector("minNetDebt()"), [borrowerOperationsAbi, "minNetDebt", 1_800n * 10n ** 18n]],
    [toFunctionSelector("getBorrowingFee(uint256)"), [borrowerOperationsAbi, "getBorrowingFee", 18n * 10n ** 18n]],
    [toFunctionSelector("interestRateManager()"), [borrowerOperationsAbi, "interestRateManager", interestRateManager]],
    [toFunctionSelector("governableVariables()"), [borrowerOperationsAbi, "governableVariables", governableVariables]],
    [toFunctionSelector("getTroveStatus(address)"), [troveManagerAbi, "getTroveStatus", 0]],
    [toFunctionSelector("isAccountFeeExempt(address)"), [governableVariablesAbi, "isAccountFeeExempt", false]],
    [toFunctionSelector("interestRate()"), [interestRateManagerAbi, "interestRate", 100]]
  ]);
  const requests = [];
  let balanceReads = 0;
  const balanceOfSelector = toFunctionSelector("balanceOf(address)");
  const blockHash = `0x${"b".repeat(64)}`;
  const zeroHash = `0x${"0".repeat(64)}`;
  const provider = {
    requests,
    async request({ method, params = [] }) {
      requests.push({ method, params });
      switch (method) {
        case "eth_chainId": return "0x7b7b";
        case "eth_accounts": return [borrower];
        case "eth_blockNumber": return "0x100";
        case "eth_getCode": return "0x6000";
        case "eth_getBlockByNumber":
          return {
            number: "0x100",
            hash: blockHash,
            parentHash: zeroHash,
            nonce: "0x0000000000000000",
            sha3Uncles: zeroHash,
            logsBloom: `0x${"0".repeat(512)}`,
            transactions: [],
            stateRoot: blockHash,
            receiptsRoot: blockHash,
            miner: interestRateManager,
            difficulty: "0x0",
            totalDifficulty: "0x0",
            extraData: "0x",
            size: "0x100",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            timestamp: "0x64",
            uncles: [],
            baseFeePerGas: "0x3b9aca00"
          };
        case "eth_call": {
          const selector = params[0].data.slice(0, 10);
          if (selector === balanceOfSelector) {
            balanceReads += 1;
            return encodeFunctionResult({
              abi: musdAbi,
              functionName: "balanceOf",
              result: balanceReads === 1 ? 0n : 1_800n * 10n ** 18n
            });
          }
          const response = functions.get(selector);
          if (!response) throw new Error(`Unexpected contract call selector: ${selector}`);
          const [abi, functionName, result] = response;
          return encodeFunctionResult({ abi, functionName, result });
        }
        case "eth_getBalance": return `0x${nativeBalance.toString(16)}`;
        case "eth_estimateGas": return "0x493e0";
        case "eth_gasPrice": return "0x3b9aca00";
        case "eth_sendTransaction": {
          const [transaction] = params;
          assert.equal(transaction.from.toLowerCase(), borrower.toLowerCase());
          assert.equal(transaction.to.toLowerCase(), MEZO_TESTNET_BORROWER_OPERATIONS.toLowerCase());
          assert.equal(BigInt(transaction.value), 51n * 10n ** 15n);
          assert.equal(transaction.data.slice(0, 10), toFunctionSelector("openTrove(uint256,address,address)"));
          assert.equal(BigInt(`0x${transaction.data.slice(10, 74)}`), 1_800n * 10n ** 18n);
          return borrowTransactionHash;
        }
        case "eth_getTransactionReceipt":
          return {
            transactionHash: borrowTransactionHash,
            transactionIndex: "0x0",
            blockHash,
            blockNumber: "0x101",
            from: borrower,
            to: MEZO_TESTNET_BORROWER_OPERATIONS,
            cumulativeGasUsed: "0x493e0",
            gasUsed: "0x493e0",
            contractAddress: null,
            logs: [],
            logsBloom: `0x${"0".repeat(512)}`,
            status: "0x1",
            effectiveGasPrice: "0x3b9aca00",
            type: "0x2"
          };
        default: throw new Error(`Unexpected wallet RPC method: ${method}`);
      }
    }
  };
  return provider;
}

test("trove risk uses Mezo's minimum ratio and RelayGuard's review buffer", () => {
  assert.equal(classifyTroveRisk(0), "inactive");
  assert.equal(classifyTroveRisk(1, (TROVE_MINIMUM_ICR - 1n).toString()), "below_minimum");
  assert.equal(classifyTroveRisk(1, TROVE_MINIMUM_ICR.toString()), "review_required");
  assert.equal(classifyTroveRisk(1, (TROVE_REVIEW_ICR - 1n).toString()), "review_required");
  assert.equal(classifyTroveRisk(1, TROVE_REVIEW_ICR.toString()), "healthy");
});

test("controlled trove policy matrix keeps Mezo thresholds exact", () => {
  const cases = [
    [TROVE_MINIMUM_ICR - 1n, "below_minimum"],
    [TROVE_MINIMUM_ICR, "review_required"],
    [TROVE_REVIEW_ICR - 1n, "review_required"],
    [TROVE_REVIEW_ICR, "healthy"]
  ];
  for (const [ratio, expected] of cases) {
    assert.equal(classifyTroveRisk(1, ratio.toString()), expected);
  }
});

test("testnet borrow preflight computes collateral from composite debt and PriceFeed", () => {
  const debt = 2_001_800_000_000_000_000_000n;
  const price = 80_000n * 10n ** 18n;
  const minimum = minimumCollateralForIcr(debt, price);
  assert.equal(minimum, 50_045_000_000_000_000n);
  assert.ok(calculateTroveIcr(minimum, price, debt) >= TROVE_OPENING_TARGET_ICR);
  assert.ok(calculateTroveIcr(minimum - 1n, price, debt) < TROVE_OPENING_TARGET_ICR);
  assert.throws(() => minimumCollateralForIcr(debt, 0n), /invalid Mezo terms/);
  assert.throws(() => calculateTroveIcr(0n, price, debt), /invalid Mezo terms/);
});

test("borrow funding check reports collateral shortfall before gas estimation", () => {
  const balance = 50_000_000_000_000_000n;
  const collateral = 50_258_120_000_000_000n;
  assert.match(
    getTroveFundingError(balance, collateral),
    /wallet has 0\.05 BTC, but the selected collateral before gas requires 0\.05025812 BTC.*add at least 0\.00025812 more Mezo Testnet BTC/i
  );
  assert.equal(getTroveFundingError(collateral, collateral), undefined);
  assert.match(
    getTroveFundingError(collateral, collateral, 1_000_000_000_000n),
    /selected collateral plus estimated gas requires 0\.05025912 BTC.*add at least 0\.000001 more/i
  );
});

test("borrow quote rejects insufficient collateral before requesting gas estimation", async () => {
  const provider = createBorrowFlowProvider({ nativeBalance: 50n * 10n ** 15n });
  await assert.rejects(
    quoteMezoTroveOpen(provider, borrower, 51n * 10n ** 15n),
    /wallet has 0\.05 BTC, but the selected collateral before gas requires 0\.051 BTC/i
  );
  assert.equal(provider.requests.filter(({ method }) => method === "eth_estimateGas").length, 0);
});

test("RelayGuard borrow flow quotes, submits, confirms, and refreshes MUSD without paying the invoice", async () => {
  const provider = createBorrowFlowProvider();
  const progress = [];
  const quote = await quoteMezoTroveOpen(provider, borrower, 51n * 10n ** 15n);
  assert.equal(quote.principalAtomic, (1_800n * 10n ** 18n).toString());
  assert.equal(quote.borrowingFeeAtomic, (18n * 10n ** 18n).toString());
  assert.equal(quote.gasCompensationAtomic, (200n * 10n ** 18n).toString());
  assert.ok(BigInt(quote.estimatedGas) > 0n);
  assert.ok(BigInt(quote.estimatedGasCostAtomic) > 0n);

  const result = await openMezoTestnetTrove(
    provider,
    borrower,
    quote,
    (1_000n * 10n ** 18n).toString(),
    (message) => progress.push(message)
  );

  assert.equal(result.hash, borrowTransactionHash);
  assert.equal(result.musdBalanceAtomic, (1_800n * 10n ** 18n).toString());
  assert.equal(provider.requests.filter(({ method }) => method === "eth_sendTransaction").length, 1);
  assert.equal(provider.requests.filter(({ method }) => method === "eth_getTransactionReceipt").length, 1);
  assert.ok(progress.some((message) => message.includes("No invoice payment will be submitted")));
  assert.ok(provider.requests.every(({ method }) => method !== "personal_sign"));
  assert.ok(provider.requests.every(({ method }) => method !== "eth_sendRawTransaction"));
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

test("invalid protocol ratios, PriceFeed data, and RPC failures fail closed", async () => {
  assert.throws(() => classifyTroveRisk(1, "1.5"), /invalid active-trove collateral ratio/);
  const baseClient = {
    async getBlockNumber() { return 1n; },
    async getBlock() { return { timestamp: 1n }; },
    async readContract({ functionName }) {
      switch (functionName) {
        case "fetchPrice": return 2_000n * 10n ** 18n;
        case "getTroveStatus": return 1;
        case "getCurrentICR": return TROVE_REVIEW_ICR;
        case "getTroveColl": return 45_000_000_000_000_000n;
        case "getTroveDebt": return 2_001_800_000_000_000_000_000n;
        default: throw new Error(`Unexpected contract read: ${functionName}`);
      }
    }
  };
  await assert.rejects(readMezoTroveHealth({
    ...baseClient,
    async readContract() { throw new Error("PriceFeed RPC unavailable"); }
  }, borrower), /PriceFeed RPC unavailable/);
  for (const failedRead of ["getTroveStatus", "getCurrentICR", "getTroveColl", "getTroveDebt"]) {
    await assert.rejects(readMezoTroveHealth({
      ...baseClient,
      async readContract(request) {
        if (request.functionName === failedRead) throw new Error(`${failedRead} RPC unavailable`);
        return baseClient.readContract(request);
      }
    }, borrower), new RegExp(`${failedRead} RPC unavailable`));
  }
  await assert.rejects(readMezoTroveHealth({
    ...baseClient,
    async readContract({ functionName }) {
      return functionName === "fetchPrice" ? 0n : baseClient.readContract({ functionName });
    }
  }, borrower), /non-positive BTC price/);
  await assert.rejects(readMezoTroveHealth({
    ...baseClient,
    async getBlockNumber() { throw new Error("block RPC unavailable"); }
  }, borrower), /block RPC unavailable/);
});
