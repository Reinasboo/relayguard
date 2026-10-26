export const NETWORKS = ["mezo", "solana", "near", "bitcoin-lightning"] as const;

export type NetworkId = (typeof NETWORKS)[number];

export interface PaymentIntent {
  readonly agentId: string;
  readonly network: NetworkId;
  readonly asset: string;
  readonly recipient: string;
  /** Positive base-unit integer, encoded as a decimal string to avoid float loss. */
  readonly amountAtomic: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
}

export interface SpendingPolicy {
  readonly id: string;
  readonly version: number;
  readonly agentId: string;
  readonly network: NetworkId;
  readonly asset: string;
  readonly maxTransactionAtomic: string;
  readonly dailyLimitAtomic: string;
  /** A transaction at or above this amount requires human approval. */
  readonly approvalThresholdAtomic?: string;
  readonly allowedRecipients: readonly string[];
  readonly approverIds: readonly string[];
  readonly expiresAt?: number;
}

export type AuthorizationStatus =
  | "denied"
  | "awaiting_approval"
  | "authorized"
  | "executing"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "expired";

export interface AuthorizationRecord {
  readonly id: string;
  readonly intent: PaymentIntent;
  readonly intentDigest: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly policyDigest: string;
  readonly status: AuthorizationStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly reason?: string;
  readonly transactionReference?: string;
  readonly approvalExpiresAt?: number;
}

export type PolicyDecision =
  | { readonly outcome: "allow"; readonly requiresApproval: false }
  | { readonly outcome: "allow"; readonly requiresApproval: true }
  | {
      readonly outcome: "deny";
      readonly reason:
        | "invalid_intent"
        | "agent_mismatch"
        | "network_mismatch"
        | "asset_mismatch"
        | "recipient_not_allowed"
        | "transaction_limit_exceeded"
        | "daily_limit_exceeded"
        | "policy_expired"
        | "invalid_policy";
    };

export function isAtomicAmount(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}
