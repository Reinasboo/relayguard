import type { AdapterConfigResult, AdapterResult, PaymentAdapter, PreparedPayment, SettlementEvidence } from "./contract.js";
import type { PaymentIntent } from "../core/domain.js";

export abstract class BaseAdapter implements PaymentAdapter {
  abstract readonly identity: PaymentAdapter["identity"];

  protected readonly requiredKeys: readonly string[];

  constructor(requiredKeys: readonly string[] = []) {
    this.requiredKeys = requiredKeys;
  }

  validateConfiguration(config: Readonly<Record<string, string | undefined>>): AdapterConfigResult {
    const missing = this.requiredKeys.filter((key) => !config[key]?.trim());
    const errors = missing.map((key) => `${this.identity.name} requires a value for '${key}'.`);
    return {
      valid: errors.length === 0,
      errors
    };
  }

  protected unsupported<T>(message: string): AdapterResult<T> {
    return {
      supported: false,
      code: "unsupported_capability",
      message
    };
  }

  protected unconfigured<T>(message: string): AdapterResult<T> {
    return {
      supported: false,
      code: "not_configured",
      message
    };
  }

  protected executionFailed<T>(message: string): AdapterResult<T> {
    return {
      supported: false,
      code: "execution_failed",
      message
    };
  }

  abstract prepare(intent: PaymentIntent, signal?: AbortSignal): Promise<AdapterResult<PreparedPayment>>;

  abstract execute(
    prepared: PreparedPayment,
    signal?: AbortSignal
  ): Promise<AdapterResult<{ readonly reference: string }>>;

  abstract lookupStatus(
    reference: string,
    signal?: AbortSignal
  ): Promise<AdapterResult<SettlementEvidence>>;

  abstract verifySettlement(
    reference: string,
    signal?: AbortSignal
  ): Promise<AdapterResult<SettlementEvidence>>;
}
