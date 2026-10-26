import type { NetworkId, PaymentIntent } from "../core/domain.js";

export const ADAPTER_CONTRACT_VERSION = "1.0.0" as const;

export type AdapterCapability =
  | "prepare_payment"
  | "execute_payment"
  | "lookup_status"
  | "verify_settlement";

export interface AdapterIdentity {
  readonly id: NetworkId;
  readonly name: string;
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  readonly capabilities: readonly AdapterCapability[];
}

export interface AdapterConfigResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface PreparedPayment {
  readonly intent: PaymentIntent;
  readonly adapterData: Readonly<Record<string, string>>;
}

export interface SettlementEvidence {
  readonly state: "pending" | "confirmed" | "failed" | "unknown";
  readonly reference?: string;
  readonly asset?: string;
  readonly sender?: string;
  readonly recipient?: string;
  readonly amountAtomic?: string;
  readonly observedAt: number;
  readonly source: string;
}

export type AdapterResult<T> =
  | { readonly supported: true; readonly value: T }
  | {
      readonly supported: false;
      readonly code: "unsupported_capability" | "not_configured" | "execution_failed";
      readonly message: string;
    };

export interface PaymentAdapter {
  readonly identity: AdapterIdentity;
  validateConfiguration(config: Readonly<Record<string, string | undefined>>): AdapterConfigResult;
  prepare(intent: PaymentIntent, signal?: AbortSignal): Promise<AdapterResult<PreparedPayment>>;
  execute(
    prepared: PreparedPayment,
    signal?: AbortSignal
  ): Promise<AdapterResult<{ readonly reference: string }>>;
  lookupStatus(
    reference: string,
    signal?: AbortSignal
  ): Promise<AdapterResult<SettlementEvidence>>;
  verifySettlement(
    reference: string,
    signal?: AbortSignal
  ): Promise<AdapterResult<SettlementEvidence>>;
}

export function unsupported<T>(message: string): AdapterResult<T> {
  return { supported: false, code: "unsupported_capability", message };
}
