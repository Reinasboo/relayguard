import { decodeEventLog, getAddress, parseAbi, type PublicClient } from "viem";
import { evaluatePolicy } from "../core/policy.js";
import type { SpendingPolicy } from "../core/domain.js";
import { applyMezoTrovePolicy, classifyTroveRisk, readMezoTroveHealth } from "./trove-health.js";

export const MUSD_TESTNET = getAddress("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
export const DEMO_PAYER = getAddress("0x2D6d690df41807910826e799A34D7fB418480828");
export const DEMO_MERCHANT = getAddress("0x840E5bBF20D725f581752f8A4021ADd730550d47");
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const historicalPayments = [
  { label: "Customer invoice", amountAtomic: "1000000000000000000", amount: "1.00 MUSD",
    hash: "0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868" },
  { label: "Agent API access", amountAtomic: "1000000000000000", amount: "0.001 MUSD",
    hash: "0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c" }
] as const;

/** Matches the token event's payer, not the facilitator's outer transaction sender. */
export function matchesHistoricalTransfer(log: { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }, amount: string): boolean {
  if (log.address.toLowerCase() !== MUSD_TESTNET.toLowerCase()) return false;
  try {
    const event = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
    return event.eventName === "Transfer" && event.args.from.toLowerCase() === DEMO_PAYER.toLowerCase() &&
      event.args.to.toLowerCase() === DEMO_MERCHANT.toLowerCase() && event.args.value.toString() === amount;
  } catch { return false; }
}

export async function readReviewEvidence(client: PublicClient) {
  if (await client.getChainId() !== 31611) throw new Error("Expected Mezo Testnet chain 31611.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [code, symbol, decimals, trove, payments] = await Promise.all([
    client.getBytecode({ address: MUSD_TESTNET, blockNumber }),
    client.readContract({ address: MUSD_TESTNET, abi: tokenAbi, functionName: "symbol", blockNumber }),
    client.readContract({ address: MUSD_TESTNET, abi: tokenAbi, functionName: "decimals", blockNumber }),
    readMezoTroveHealth(client, DEMO_PAYER).then((value) => ({ available: true as const, value }))
      .catch(() => ({ available: false as const })),
    Promise.all(historicalPayments.map(async (payment) => {
      try {
        const receipt = await client.getTransactionReceipt({ hash: payment.hash });
        const verified = receipt.status === "success" && receipt.logs.some((log) => matchesHistoricalTransfer(log, payment.amountAtomic));
        return { ...payment, verified, status: verified ? "verified" : "mismatch", blockNumber: receipt.blockNumber.toString() };
      } catch {
        return { ...payment, verified: false, status: "unavailable", blockNumber: null };
      }
    }))
  ]);
  if (!code || code === "0x" || symbol !== "MUSD" || decimals !== 18) throw new Error("Canonical Mezo Testnet MUSD contract verification failed.");
  return { observedAt: Date.now(), chainId: 31611, blockNumber: blockNumber.toString(),
    token: { address: MUSD_TESTNET, symbol, decimals, deployed: true }, trove, payments,
    payer: DEMO_PAYER, merchant: DEMO_MERCHANT,
    disclosure: "Read-only Mezo Testnet verification. Historical receipts are checked again now. Policy scenarios are controlled examples, not live authorizations." };
}

export type ReviewScenario = "healthy" | "review" | "blocked" | "unavailable";
export function previewMezoPolicy(scenario: ReviewScenario, amountAtomic = "1000000000000000000") {
  if (!/^[1-9][0-9]{0,35}$/.test(amountAtomic)) throw new Error("Invalid positive base-unit amount.");
  if (scenario === "unavailable") return { mode: "controlled" as const, scenario, outcome: "paused", reason: "Protocol reads unavailable. No authorization or payment is created.", icrAtomic: null };
  const ratios = { healthy: "1800000000000000000", review: "1250000000000000000", blocked: "1090000000000000000" };
  if (!(scenario in ratios)) throw new Error("Invalid policy scenario.");
  const icrAtomic = ratios[scenario];
  const policy: SpendingPolicy = applyMezoTrovePolicy({ id: "review-example", version: 1, agentId: "review-agent",
    network: "mezo", asset: "MUSD", maxTransactionAtomic: "25000000000000000000", dailyLimitAtomic: "100000000000000000000",
    approvalThresholdAtomic: "10000000000000000000", allowedRecipients: [DEMO_MERCHANT], approverIds: ["example-operator"]
  }, classifyTroveRisk(1, icrAtomic));
  const decision = evaluatePolicy({ agentId: policy.agentId, network: "mezo", asset: "MUSD", recipient: DEMO_MERCHANT,
    amountAtomic, purpose: "Controlled reviewer example", idempotencyKey: "read-only-preview" }, policy, { now: Date.now(), spentTodayAtomic: 0n });
  return { mode: "controlled" as const, scenario, icrAtomic, policy, decision,
    outcome: decision.outcome === "deny" ? "blocked" : decision.requiresApproval ? "approval_required" : "authorized",
    reason: decision.outcome === "deny"
      ? decision.reason === "transaction_limit_exceeded" ? "This payment exceeds the 25 MUSD per-payment limit."
        : decision.reason === "mezo_trove_below_minimum" ? "The example trove is below Mezo's 110% minimum collateral ratio."
          : "This request does not satisfy the example spending policy."
      : decision.requiresApproval ? "An assigned operator must approve this exact intent." : "Within example limits. Execution would remain a separate action." };
}
