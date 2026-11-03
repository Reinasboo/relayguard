import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import type { Network } from "@x402/core/types";

interface RelayGuardConfig {
  readonly resource: {
    readonly name: string;
    readonly method: "GET" | "POST";
    readonly routePath: string;
    readonly price: string;
    readonly description: string;
    readonly payTo: string;
  };
  readonly network: "eip155:31611";
  readonly facilitatorUrl: string;
  readonly testnet: true;
}

export interface RelayGuardExpressOptions {
  readonly apiKey: string;
  readonly relayguardUrl?: string;
}

function isRelayGuardConfig(value: unknown): value is RelayGuardConfig {
  if (typeof value !== "object" || value === null || !("resource" in value) ||
      typeof value.resource !== "object" || value.resource === null) {
    return false;
  }
  const config = value as Partial<RelayGuardConfig>;
  const resource = config.resource as Partial<RelayGuardConfig["resource"]>;
  let facilitatorUrl: URL;
  try {
    facilitatorUrl = new URL(config.facilitatorUrl ?? "");
  } catch {
    return false;
  }
  return (
    (resource.method === "GET" || resource.method === "POST") &&
    typeof resource.name === "string" &&
    typeof resource.description === "string" &&
    typeof resource.routePath === "string" &&
    /^\/[A-Za-z0-9/_-]*$/.test(resource.routePath) &&
    typeof resource.price === "string" &&
    /^\$\d+(?:\.\d{1,18})?$/.test(resource.price) &&
    typeof resource.payTo === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(resource.payTo) &&
    config.network === "eip155:31611" &&
    (facilitatorUrl.protocol === "https:" ||
      (["localhost", "127.0.0.1"].includes(facilitatorUrl.hostname) && facilitatorUrl.protocol === "http:")) &&
    !facilitatorUrl.username &&
    !facilitatorUrl.password &&
    config.testnet === true
  );
}

export async function createRelayGuardX402Middleware(options: RelayGuardExpressOptions) {
  if (!/^rg_test_[A-Za-z0-9_-]{43}$/.test(options.apiKey)) {
    throw new Error("A valid RelayGuard merchant API key is required.");
  }
  const relayguardUrl = new URL(options.relayguardUrl ?? "https://relayguard.vercel.app");
  if (
    (relayguardUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relayguardUrl.hostname)) ||
    relayguardUrl.username ||
    relayguardUrl.password
  ) {
    throw new Error("RelayGuard configuration must be fetched over HTTPS.");
  }
  const loadConfig = async (): Promise<RelayGuardConfig> => {
    const response = await fetch(new URL("/api/sdk/x402-config", relayguardUrl), {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`RelayGuard rejected the x402 configuration request (${response.status}).`);
    }
    const value: unknown = await response.json();
    if (!isRelayGuardConfig(value)) {
      throw new Error("RelayGuard returned an invalid x402 integration configuration.");
    }
    return value;
  };
  const value = await loadConfig();
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: value.facilitatorUrl })
  ).register(value.network as Network, new ExactEvmScheme());
  return paymentMiddleware(
    {
      [`${value.resource.method} ${value.resource.routePath}`]: {
        accepts: {
          scheme: "exact",
          price: async () => (await loadConfig()).resource.price,
          network: value.network,
          payTo: async () => (await loadConfig()).resource.payTo,
          maxTimeoutSeconds: 60
        },
        description: value.resource.description,
        mimeType: "application/json"
      }
    },
    resourceServer,
    { appName: "RelayGuard", testnet: value.testnet },
    undefined
  );
}
