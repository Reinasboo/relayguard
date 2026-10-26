import type { PaymentIntent } from "../core/domain.js";
import { BaseAdapter } from "./base.js";
import type { AdapterResult, PreparedPayment, SettlementEvidence } from "./contract.js";

export class BitcoinLightningAdapter extends BaseAdapter {
  readonly identity = {
    id: "bitcoin-lightning" as const,
    name: "Bitcoin Lightning",
    contractVersion: "1.0.0" as const,
    capabilities: ["prepare_payment", "lookup_status", "verify_settlement"] as const
  };

  constructor() {
    super(["providerUrl", "network"]);
  }

  async prepare(intent: PaymentIntent): Promise<AdapterResult<PreparedPayment>> {
    return this.unconfigured(
      "Lightning invoice preparation requires a verified node or provider interface and merchant order metadata."
    );
  }

  async execute(prepared: PreparedPayment): Promise<AdapterResult<{ readonly reference: string }>> {
    return this.unconfigured(
      "Lightning payment execution is intentionally disabled until a sanctioned provider or node flow is configured and authorized."
    );
  }

  async lookupStatus(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `Lightning payment status for '${reference}' is unavailable without an authorized node/provider interface.`
    );
  }

  async verifySettlement(reference: string): Promise<AdapterResult<SettlementEvidence>> {
    return this.unconfigured(
      `Lightning settlement verification for '${reference}' is intentionally blocked until invoice and payment status are verified against the selected provider.`
    );
  }
}
