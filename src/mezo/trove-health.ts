import { getAddress, parseAbi, type Address, type PublicClient } from "viem";
import type { MezoTroveEvidence, MezoTroveRisk, SpendingPolicy } from "../core/domain.js";

export const MEZO_TESTNET_TROVE_MANAGER = getAddress("0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0");
export const MEZO_TESTNET_PRICE_FEED = getAddress("0x86bCF0841622a5dAC14A313a15f96A95421b9366");
export const TROVE_MINIMUM_ICR = 110n * 10n ** 16n;
export const TROVE_REVIEW_ICR = 150n * 10n ** 16n;

const troveManagerAbi = parseAbi([
  "function getTroveStatus(address borrower) view returns (uint8)",
  "function getCurrentICR(address borrower, uint256 price) view returns (uint256)",
  "function getTroveColl(address borrower) view returns (uint256)",
  "function getTroveDebt(address borrower) view returns (uint256)"
]);

const priceFeedAbi = parseAbi([
  "function fetchPrice() view returns (uint256)"
]);

export type TroveRisk = MezoTroveRisk;

export interface MezoTroveHealth extends MezoTroveEvidence {
  readonly borrower: Address;
}

export function classifyTroveRisk(status: number, icrAtomic?: string): TroveRisk {
  if (!Number.isSafeInteger(status) || status < 0 || status > 255) {
    throw new Error("Mezo returned an invalid trove status.");
  }
  if (status !== 1) return "inactive";
  if (!icrAtomic || !/^(0|[1-9][0-9]*)$/.test(icrAtomic)) {
    throw new Error("Mezo returned an invalid active-trove collateral ratio.");
  }
  const icr = BigInt(icrAtomic);
  if (icr < TROVE_MINIMUM_ICR) return "below_minimum";
  if (icr < TROVE_REVIEW_ICR) return "review_required";
  return "healthy";
}

export async function readMezoTroveHealth(
  client: PublicClient,
  borrower: Address
): Promise<MezoTroveHealth> {
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const [price, status] = await Promise.all([
    client.readContract({
      address: MEZO_TESTNET_PRICE_FEED,
      abi: priceFeedAbi,
      functionName: "fetchPrice",
      blockNumber
    }),
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveStatus",
      args: [borrower],
      blockNumber
    })
  ]);
  if (price <= 0n) {
    throw new Error("Mezo PriceFeed returned a non-positive BTC price.");
  }
  const evidence = {
    protocol: "mezo-musd-trove" as const,
    borrower,
    chainId: 31611 as const,
    blockNumber: blockNumber.toString(),
    observedAt: Number(block.timestamp * 1000n),
    priceAtomic: price.toString()
  };
  if (status !== 1) {
    return {
      status: "inactive",
      risk: classifyTroveRisk(Number(status)),
      ...evidence
    };
  }

  const [icr, collateral, debt] = await Promise.all([
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getCurrentICR",
      args: [borrower, price],
      blockNumber
    }),
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveColl",
      args: [borrower],
      blockNumber
    }),
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveDebt",
      args: [borrower],
      blockNumber
    })
  ]);
  const icrAtomic = icr.toString();
  return {
    status: "active",
    risk: classifyTroveRisk(Number(status), icrAtomic),
    ...evidence,
    collateralAtomic: collateral.toString(),
    debtAtomic: debt.toString(),
    icrAtomic
  };
}

export function applyMezoTrovePolicy(
  policy: SpendingPolicy,
  risk: MezoTroveRisk
): SpendingPolicy {
  return {
    ...policy,
    mezoTroveRisk: risk,
    ...(risk === "review_required" && policy.asset === "MUSD"
      ? { approvalThresholdAtomic: "1" }
      : {})
  };
}
