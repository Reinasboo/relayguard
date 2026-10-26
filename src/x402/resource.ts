import { parseUnits } from "viem";

export interface MezoAgentIntegrationBriefOptions {
  readonly endpoint: string;
  readonly price: string;
  readonly payTo: string;
}

const MUSD_ADDRESS = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export function createMezoAgentIntegrationBrief({
  endpoint,
  price,
  payTo
}: MezoAgentIntegrationBriefOptions) {
  if (!/^\$\d+(?:\.\d{1,18})?$/.test(price)) {
    throw new Error("x402 resource price must be a valid MUSD dollar amount.");
  }
  if (!/^https?:\/\/[^/]+\/api\/paid-resource$/.test(endpoint)) {
    throw new Error("x402 resource endpoint must be an absolute protected-resource URL.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error("x402 resource recipient must be an EVM address.");
  }

  return {
    ok: true,
    resource: {
      id: "mezo-musd-agent-integration-brief",
      title: "Mezo MUSD Agent Integration Brief",
      version: "1.0.0",
      summary: "A machine-readable guide to accepting and verifying exact MUSD payments with x402 on Mezo."
    },
    integration: {
      network: {
        name: "Mezo Testnet",
        caip2: "eip155:31611",
        chainId: 31611,
        explorer: "https://explorer.test.mezo.org"
      },
      payment: {
        protocol: "x402",
        version: 2,
        scheme: "exact",
        amount: price,
        amountAtomic: parseUnits(price.slice(1), 18).toString(),
        asset: {
          symbol: "MUSD",
          decimals: 18,
          address: MUSD_ADDRESS
        },
        recipient: payTo,
        transferMethod: "Permit2",
        permit2: PERMIT2_ADDRESS,
        approvalScope: "Approve only the exact requested MUSD amount."
      },
      endpoint: {
        url: endpoint,
        method: "GET",
        accept: "application/json",
        unpaidResponse: 402,
        paidResponse: 200
      }
    },
    agentPlaybook: [
      {
        step: 1,
        action: "Request the protected URL and inspect the x402 payment challenge."
      },
      {
        step: 2,
        action: "Confirm the network, MUSD contract, exact amount, recipient, and resource URL before signing."
      },
      {
        step: 3,
        action: "If needed, approve Permit2 for exactly the requested MUSD amount; never grant an unlimited approval for this payment."
      },
      {
        step: 4,
        action: "Sign the Permit2 typed-data authorization with the payer wallet and submit it using an x402-compatible client."
      },
      {
        step: 5,
        action: "Use the protected response only after HTTP 200 and successful facilitator settlement confirmation."
      }
    ],
    verificationChecklist: [
      "Require Mezo Testnet (chain ID 31611).",
      "Match the challenge MUSD contract to the published address.",
      "Bind the signature to the exact amount, recipient, and resource.",
      "Check settlement success; a submitted transaction hash alone is not proof.",
      "Mezo Testnet tokens are for testing and have no guaranteed monetary value."
    ],
    notes: {
      assessment: "This is a configuration-based integration guide, not a live chain health report or AI-generated transaction recommendation.",
      settlementEvidence: "The x402 client displays the facilitator-confirmed settlement transaction separately from this reusable integration brief."
    }
  };
}
