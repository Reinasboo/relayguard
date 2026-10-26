import type { PaymentIntent } from "../core/domain.js";
import { BaseAdapter } from "./base.js";
import type { AdapterResult, PreparedPayment, SettlementEvidence } from "./contract.js";

export class SolanaX402Adapter extends BaseAdapter {
  readonly identity = {
    id: "solana" as const,
    name: "Solana x402",
    contractVersion: "1.0.0" as const,
    capabilities: ["prepare_payment", "execute_payment", "lookup_status", "verify_settlement"] as const
  };

  constructor() {
    super(["rpcUrl", "network", "resourceServerUrl"]);
  }

  async prepare(intent: PaymentIntent): Promise<AdapterResult<PreparedPayment>> {
    return this.unconfigured(
      "Solana x402 payment preparation requires a verified resource server and supported facilitator configuration."
    );
  }

  async execute(prepared: PreparedPayment): Promise<AdapterResult<{ readonly reference: string }>> {
    return this.unconfigured(
      "x402 execution is not available until a valid Solana payment route, facilitator, and signed transfer are configured."
    );
  }

  async lookupStatus(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `Solana x402 status lookup for '${reference}' is disabled until the provider and settlement endpoint are verified.`
    );
  }

  async verifySettlement(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `Solana x402 settlement verification for '${reference}' is intentionally blocked without authoritative network evidence.`
    );
  }
}
