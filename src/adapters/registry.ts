import type { PaymentAdapter } from "./contract.js";
import { BitcoinLightningAdapter } from "./bitcoin-lightning.js";
import { MezoAdapter } from "./mezo.js";
import { NearAdapter } from "./near.js";
import { SolanaX402Adapter } from "./solana-x402.js";

export function createAdapterRegistry(): ReadonlyMap<string, PaymentAdapter> {
  const registry: Map<string, PaymentAdapter> = new Map();
  registry.set("mezo", new MezoAdapter());
  registry.set("solana", new SolanaX402Adapter());
  registry.set("near", new NearAdapter());
  registry.set("bitcoin-lightning", new BitcoinLightningAdapter());
  return registry;
}

export function getAdapter(network: string): PaymentAdapter | undefined {
  return createAdapterRegistry().get(network);
}
