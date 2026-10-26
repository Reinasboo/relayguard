import { createHash } from "node:crypto";
import type { PaymentIntent, PolicyDecision, SpendingPolicy } from "./domain.js";
import { isAtomicAmount } from "./domain.js";

export interface PolicyEvaluationContext {
  readonly now: number;
  readonly spentTodayAtomic: bigint;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function validatePolicy(policy: SpendingPolicy): boolean {
  return Boolean(
    policy.id.trim() &&
      Number.isSafeInteger(policy.version) &&
      policy.version > 0 &&
      policy.agentId.trim() &&
      policy.asset.trim() &&
      isAtomicAmount(policy.maxTransactionAtomic) &&
      BigInt(policy.maxTransactionAtomic) > 0n &&
      isAtomicAmount(policy.dailyLimitAtomic) &&
      BigInt(policy.dailyLimitAtomic) > 0n &&
      policy.allowedRecipients.every((item) => item.trim().length > 0) &&
      policy.approverIds.every((item) => item.trim().length > 0) &&
      (policy.approvalThresholdAtomic === undefined ||
        (isAtomicAmount(policy.approvalThresholdAtomic) &&
          BigInt(policy.approvalThresholdAtomic) > 0n &&
          policy.approverIds.length > 0)) &&
      (policy.expiresAt === undefined || Number.isFinite(policy.expiresAt))
  );
}

export function evaluatePolicy(
  intent: PaymentIntent,
  policy: SpendingPolicy,
  context: PolicyEvaluationContext
): PolicyDecision {
  if (
    !intent.agentId.trim() ||
    !intent.asset.trim() ||
    !intent.recipient.trim() ||
    !intent.purpose.trim() ||
    !intent.idempotencyKey.trim() ||
    !isAtomicAmount(intent.amountAtomic) ||
    BigInt(intent.amountAtomic) <= 0n ||
    !Number.isFinite(context.now) ||
    context.spentTodayAtomic < 0n
  ) {
    return { outcome: "deny", reason: "invalid_intent" };
  }
  if (!validatePolicy(policy)) {
    return { outcome: "deny", reason: "invalid_policy" };
  }
  if (policy.expiresAt !== undefined && context.now >= policy.expiresAt) {
    return { outcome: "deny", reason: "policy_expired" };
  }
  if (intent.agentId !== policy.agentId) {
    return { outcome: "deny", reason: "agent_mismatch" };
  }
  if (intent.network !== policy.network) {
    return { outcome: "deny", reason: "network_mismatch" };
  }
  if (intent.asset !== policy.asset) {
    return { outcome: "deny", reason: "asset_mismatch" };
  }
  if (!policy.allowedRecipients.includes(intent.recipient)) {
    return { outcome: "deny", reason: "recipient_not_allowed" };
  }

  const amount = BigInt(intent.amountAtomic);
  if (amount > BigInt(policy.maxTransactionAtomic)) {
    return { outcome: "deny", reason: "transaction_limit_exceeded" };
  }
  if (context.spentTodayAtomic + amount > BigInt(policy.dailyLimitAtomic)) {
    return { outcome: "deny", reason: "daily_limit_exceeded" };
  }

  const requiresApproval =
    policy.approvalThresholdAtomic !== undefined &&
    amount >= BigInt(policy.approvalThresholdAtomic);
  return { outcome: "allow", requiresApproval };
}
