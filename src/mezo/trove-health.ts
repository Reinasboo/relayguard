import { getAddress, parseAbi, type Address, type PublicClient } from "viem";

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

export type TroveRisk = "inactive" | "healthy" | "review_required" | "below_minimum";

export interface MezoTroveHealth {
  readonly status: "active" | "inactive";
  readonly risk: TroveRisk;
  readonly borrower: Address;
  readonly priceAtomic?: string;
  readonly collateralAtomic?: string;
  readonly debtAtomic?: string;
  readonly icrAtomic?: string;
  readonly observedAt: number;
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
  borrower: Address,
  observedAt = Date.now()
): Promise<MezoTroveHealth> {
  const price = await client.readContract({
    address: MEZO_TESTNET_PRICE_FEED,
    abi: priceFeedAbi,
    functionName: "fetchPrice"
  });
  const status = await client.readContract({
    address: MEZO_TESTNET_TROVE_MANAGER,
    abi: troveManagerAbi,
    functionName: "getTroveStatus",
    args: [borrower]
  });
  if (status !== 1) {
    return {
      status: "inactive",
      risk: classifyTroveRisk(Number(status)),
      borrower,
      priceAtomic: price.toString(),
      observedAt
    };
  }

  const [icr, collateral, debt] = await Promise.all([
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getCurrentICR",
      args: [borrower, price]
    }),
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveColl",
      args: [borrower]
    }),
    client.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveDebt",
      args: [borrower]
    })
  ]);
  const icrAtomic = icr.toString();
  return {
    status: "active",
    risk: classifyTroveRisk(Number(status), icrAtomic),
    borrower,
    priceAtomic: price.toString(),
    collateralAtomic: collateral.toString(),
    debtAtomic: debt.toString(),
    icrAtomic,
    observedAt
  };
}
