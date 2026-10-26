import type { PaymentIntent } from "../core/domain.js";
import { BaseAdapter } from "./base.js";
import type { AdapterResult, PreparedPayment, SettlementEvidence } from "./contract.js";

export class NearAdapter extends BaseAdapter {
  readonly identity = {
    id: "near" as const,
    name: "NEAR",
    contractVersion: "1.0.0" as const,
    capabilities: ["prepare_payment", "lookup_status", "verify_settlement"] as const
  };

  constructor() {
    super(["rpcUrl", "network"]);
  }

  async prepare(intent: PaymentIntent): Promise<AdapterResult<PreparedPayment>> {
    return this.unconfigured(
      "NEAR transaction preparation requires an authorized RPC endpoint and a verified account/permission model."
    );
  }

  async execute(prepared: PreparedPayment): Promise<AdapterResult<{ readonly reference: string }>> {
    return this.unconfigured(
      "NEAR execution is intentionally disabled until the signer and permission model are verified against the selected network."
    );
  }

  async lookupStatus(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `NEAR status checks for '${reference}' are unavailable without a validated RPC source.`
    );
  }

  async verifySettlement(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `NEAR settlement verification for '${reference}' is intentionally blocked without authoritative block and receipt evidence.`
    );
  }
}
