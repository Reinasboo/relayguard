import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hash
} from "viem";
import { mezoTestnet } from "viem/chains";

export interface CheckoutEip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export const MEZO_TESTNET_BORROWER_OPERATIONS = getAddress("0xCdF7028ceAB81fA0C6971208e83fa7872994beE5");
export const MEZO_TESTNET_TROVE_MANAGER = getAddress("0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0");
export const MEZO_TESTNET_PRICE_FEED = getAddress("0x86bCF0841622a5dAC14A313a15f96A95421b9366");
export const MEZO_TESTNET_MUSD = getAddress("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
export const MUSD_GAS_COMPENSATION = 200n * 10n ** 18n;
export const TROVE_OPENING_TARGET_ICR = 200n * 10n ** 16n;

const zeroAddress = "0x0000000000000000000000000000000000000000";
const borrowerOperationsAbi = parseAbi([
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function minNetDebt() view returns (uint256)",
  "function getBorrowingFee(uint256 _debt) view returns (uint256)",
  "function interestRateManager() view returns (address)",
  "function governableVariables() view returns (address)"
]);
const interestRateManagerAbi = parseAbi([
  "function interestRate() view returns (uint16)"
]);
const governableVariablesAbi = parseAbi([
  "function isAccountFeeExempt(address account) view returns (bool)"
]);
const troveManagerAbi = parseAbi([
  "function getTroveStatus(address borrower) view returns (uint8)"
]);
const priceFeedAbi = parseAbi([
  "function fetchPrice() view returns (uint256)"
]);
const musdAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
]);

export interface CheckoutWalletPreflight {
  readonly blockNumber: string;
  readonly musdBalanceAtomic: string;
  readonly nativeBalanceAtomic: string;
  readonly requiredMusdAtomic: string;
  readonly troveStatus: "inactive" | "active";
  readonly transferGasAtomic?: string;
  readonly transferGas: string;
  readonly sufficientMusd: boolean;
  readonly sufficientGas: boolean;
}

export interface MezoTroveOpeningTerms {
  readonly blockNumber: string;
  readonly priceAtomic: string;
  readonly principalAtomic: string;
  readonly borrowingFeeAtomic: string;
  readonly gasCompensationAtomic: string;
  readonly compositeDebtAtomic: string;
  readonly interestRateBps: string;
  readonly minimumCollateralAtomic: string;
  readonly minimumCollateral: string;
  readonly troveStatus: "inactive" | "active";
}

export interface MezoTroveOpeningQuote extends MezoTroveOpeningTerms {
  readonly collateralAtomic: string;
  readonly collateral: string;
  readonly initialIcrAtomic: string;
  readonly estimatedGas: string;
  readonly estimatedGasCostAtomic: string;
}

function createClients(provider: CheckoutEip1193Provider) {
  const transport = custom({
    request: ({ method, params }) => provider.request({ method, params })
  });
  return {
    publicClient: createPublicClient({ chain: mezoTestnet, transport }),
    walletClient: createWalletClient({ chain: mezoTestnet, transport })
  };
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Mezo returned an invalid PriceFeed value.");
  return (numerator + denominator - 1n) / denominator;
}

export function minimumCollateralForIcr(
  compositeDebtAtomic: bigint,
  priceAtomic: bigint,
  targetIcrAtomic = TROVE_OPENING_TARGET_ICR
): bigint {
  if (compositeDebtAtomic <= 0n || priceAtomic <= 0n || targetIcrAtomic <= 0n) {
    throw new Error("Cannot calculate a safe collateral amount from invalid Mezo terms.");
  }
  return divideRoundUp(compositeDebtAtomic * targetIcrAtomic, priceAtomic);
}

export function calculateTroveIcr(
  collateralAtomic: bigint,
  priceAtomic: bigint,
  compositeDebtAtomic: bigint
): bigint {
  if (collateralAtomic <= 0n || priceAtomic <= 0n || compositeDebtAtomic <= 0n) {
    throw new Error("Cannot calculate trove health from invalid Mezo terms.");
  }
  return collateralAtomic * priceAtomic / compositeDebtAtomic;
}

async function assertMezoTestnet(publicClient: ReturnType<typeof createPublicClient>) {
  const chainId = await publicClient.getChainId();
  if (chainId !== mezoTestnet.id) {
    throw new Error(`This optional BorrowerOperations flow is testnet-only. Connected chain ID: ${chainId}.`);
  }
}

async function assertMezoContractsDeployed(
  publicClient: ReturnType<typeof createPublicClient>
): Promise<void> {
  const addresses = [
    MEZO_TESTNET_BORROWER_OPERATIONS,
    MEZO_TESTNET_TROVE_MANAGER,
    MEZO_TESTNET_PRICE_FEED,
    MEZO_TESTNET_MUSD
  ] as const;
  const code = await Promise.all(
    addresses.map((address) => publicClient.getBytecode({ address }))
  );
  if (code.some((value) => !value || value === "0x")) {
    throw new Error("A required official Mezo Testnet contract is unavailable. No transaction was submitted.");
  }
}

async function readTroveOpeningTerms(
  provider: CheckoutEip1193Provider,
  borrower: Address
): Promise<MezoTroveOpeningTerms> {
  const { publicClient } = createClients(provider);
  await assertMezoTestnet(publicClient);
  await assertMezoContractsDeployed(publicClient);
  const blockNumber = await publicClient.getBlockNumber();
  const [block, price, principal, managerAddress, governableVariablesAddress, troveStatus] = await Promise.all([
    publicClient.getBlock({ blockNumber }),
    publicClient.readContract({
      address: MEZO_TESTNET_PRICE_FEED,
      abi: priceFeedAbi,
      functionName: "fetchPrice",
      blockNumber
    }),
    publicClient.readContract({
      address: MEZO_TESTNET_BORROWER_OPERATIONS,
      abi: borrowerOperationsAbi,
      functionName: "minNetDebt",
      blockNumber
    }),
    publicClient.readContract({
      address: MEZO_TESTNET_BORROWER_OPERATIONS,
      abi: borrowerOperationsAbi,
      functionName: "interestRateManager",
      blockNumber
    }),
    publicClient.readContract({
      address: MEZO_TESTNET_BORROWER_OPERATIONS,
      abi: borrowerOperationsAbi,
      functionName: "governableVariables",
      blockNumber
    }),
    publicClient.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveStatus",
      args: [borrower],
      blockNumber
    })
  ]);
  if (price <= 0n || principal <= 0n || !managerAddress || managerAddress === zeroAddress) {
    throw new Error("Mezo returned invalid trove-opening terms. No transaction was submitted.");
  }
  if (!governableVariablesAddress || governableVariablesAddress === zeroAddress) {
    throw new Error("Mezo’s borrower fee configuration is unavailable. No transaction was submitted.");
  }
  const [feeExempt, interestRate] = await Promise.all([
    publicClient.readContract({
      address: getAddress(governableVariablesAddress),
      abi: governableVariablesAbi,
      functionName: "isAccountFeeExempt",
      args: [borrower],
      blockNumber
    }),
    publicClient.readContract({
      address: getAddress(managerAddress),
      abi: interestRateManagerAbi,
      functionName: "interestRate",
      blockNumber
    })
  ]);
  const borrowingFee = feeExempt
    ? 0n
    : await publicClient.readContract({
        address: MEZO_TESTNET_BORROWER_OPERATIONS,
        abi: borrowerOperationsAbi,
        functionName: "getBorrowingFee",
        args: [principal],
        blockNumber
      });
  const managerCode = await publicClient.getBytecode({ address: getAddress(managerAddress) });
  if (!managerCode || managerCode === "0x") {
    throw new Error("Mezo’s current interest-rate contract is unavailable. No transaction was submitted.");
  }
  const compositeDebt = principal + borrowingFee + MUSD_GAS_COMPENSATION;
  const minimumCollateral = minimumCollateralForIcr(compositeDebt, price);
  return {
    blockNumber: block.number.toString(),
    priceAtomic: price.toString(),
    principalAtomic: principal.toString(),
    borrowingFeeAtomic: borrowingFee.toString(),
    gasCompensationAtomic: MUSD_GAS_COMPENSATION.toString(),
    compositeDebtAtomic: compositeDebt.toString(),
    interestRateBps: interestRate.toString(),
    minimumCollateralAtomic: minimumCollateral.toString(),
    minimumCollateral: formatUnits(minimumCollateral, 18),
    troveStatus: troveStatus === 1 ? "active" : "inactive"
  };
}

export async function getMezoTroveOpeningTerms(
  provider: CheckoutEip1193Provider,
  borrower: string
): Promise<MezoTroveOpeningTerms> {
  return readTroveOpeningTerms(provider, getAddress(borrower));
}

export async function inspectMezoCheckoutWallet(
  provider: CheckoutEip1193Provider,
  account: string,
  merchant: string,
  requiredMusdAtomic: string
): Promise<CheckoutWalletPreflight> {
  const { publicClient } = createClients(provider);
  await assertMezoTestnet(publicClient);
  const borrower = getAddress(account);
  const merchantAddress = getAddress(merchant);
  const required = BigInt(requiredMusdAtomic);
  if (required <= 0n) throw new Error("Invoice amount is invalid.");
  const blockNumber = await publicClient.getBlockNumber();
  const [musdBalance, nativeBalance, troveStatus] = await Promise.all([
    publicClient.readContract({
      address: MEZO_TESTNET_MUSD,
      abi: musdAbi,
      functionName: "balanceOf",
      args: [borrower],
      blockNumber
    }),
    publicClient.getBalance({ address: borrower, blockNumber }),
    publicClient.readContract({
      address: MEZO_TESTNET_TROVE_MANAGER,
      abi: troveManagerAbi,
      functionName: "getTroveStatus",
      args: [borrower],
      blockNumber
    })
  ]);
  const sufficientMusd = musdBalance >= required;
  let transferGas: bigint | undefined;
  let transferGasAtomic: bigint | undefined;
  if (sufficientMusd) {
    [transferGas, transferGasAtomic] = await Promise.all([
      publicClient.estimateContractGas({
        account: borrower,
        address: MEZO_TESTNET_MUSD,
        abi: musdAbi,
        functionName: "transfer",
        args: [merchantAddress, required]
      }),
      publicClient.getGasPrice()
    ]);
  }
  const estimatedTransferCost = transferGas !== undefined && transferGasAtomic !== undefined
    ? transferGas * transferGasAtomic
    : undefined;
  return {
    blockNumber: blockNumber.toString(),
    musdBalanceAtomic: musdBalance.toString(),
    nativeBalanceAtomic: nativeBalance.toString(),
    requiredMusdAtomic: required.toString(),
    troveStatus: troveStatus === 1 ? "active" : "inactive",
    ...(transferGasAtomic === undefined ? {} : { transferGasAtomic: transferGasAtomic.toString() }),
    transferGas: transferGas?.toString() ?? "0",
    sufficientMusd,
    sufficientGas: estimatedTransferCost === undefined || nativeBalance >= estimatedTransferCost
  };
}

export async function quoteMezoTroveOpen(
  provider: CheckoutEip1193Provider,
  borrowerAddress: string,
  collateralAtomic: bigint
): Promise<MezoTroveOpeningQuote> {
  const borrower = getAddress(borrowerAddress);
  if (collateralAtomic <= 0n) throw new Error("Enter a positive BTC collateral amount.");
  const terms = await readTroveOpeningTerms(provider, borrower);
  if (terms.troveStatus === "active") {
    throw new Error("This wallet already has an active trove. Manage it in the official Mezo Testnet app instead.");
  }
  if (collateralAtomic < BigInt(terms.minimumCollateralAtomic)) {
    throw new Error(
      `This collateral is below RelayGuard's 200% opening buffer. The current estimate is ${terms.minimumCollateral} BTC; recheck the PriceFeed and choose at least that amount.`
    );
  }
  const collateralRatio = calculateTroveIcr(
    collateralAtomic,
    BigInt(terms.priceAtomic),
    BigInt(terms.compositeDebtAtomic)
  );
  const { publicClient } = createClients(provider);
  const request = {
    account: borrower,
    address: MEZO_TESTNET_BORROWER_OPERATIONS,
    abi: borrowerOperationsAbi,
    functionName: "openTrove" as const,
    args: [BigInt(terms.principalAtomic), zeroAddress, zeroAddress] as const,
    value: collateralAtomic
  };
  const [estimatedGas, gasPrice, nativeBalance] = await Promise.all([
    publicClient.estimateContractGas(request),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: borrower })
  ]);
  const estimatedGasCost = estimatedGas * gasPrice;
  if (nativeBalance < collateralAtomic + estimatedGasCost) {
    throw new Error(
      `The wallet needs ${formatUnits(collateralAtomic + estimatedGasCost, 18)} BTC for the selected collateral and estimated gas; it currently has ${formatUnits(nativeBalance, 18)} BTC.`
    );
  }
  return {
    ...terms,
    collateralAtomic: collateralAtomic.toString(),
    collateral: formatUnits(collateralAtomic, 18),
    initialIcrAtomic: collateralRatio.toString(),
    estimatedGas: estimatedGas.toString(),
    estimatedGasCostAtomic: estimatedGasCost.toString()
  };
}

function sameReviewedTerms(
  previous: MezoTroveOpeningQuote,
  current: MezoTroveOpeningQuote
): boolean {
  return previous.priceAtomic === current.priceAtomic &&
    previous.principalAtomic === current.principalAtomic &&
    previous.borrowingFeeAtomic === current.borrowingFeeAtomic &&
    previous.interestRateBps === current.interestRateBps &&
    previous.collateralAtomic === current.collateralAtomic &&
    previous.initialIcrAtomic === current.initialIcrAtomic &&
    previous.estimatedGas === current.estimatedGas &&
    previous.estimatedGasCostAtomic === current.estimatedGasCostAtomic;
}

export async function openMezoTestnetTrove(
  provider: CheckoutEip1193Provider,
  borrowerAddress: string,
  reviewedQuote: MezoTroveOpeningQuote,
  requiredMusdAtomic: string,
  onProgress: (message: string) => void = () => undefined
): Promise<{ readonly hash: Hash; readonly musdBalanceAtomic: string }> {
  const borrower = getAddress(borrowerAddress);
  const requiredMusd = BigInt(requiredMusdAtomic);
  if (requiredMusd <= 0n) throw new Error("Invoice amount is invalid.");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" ||
      getAddress(accounts[0]) !== borrower) {
    throw new Error("The connected wallet changed. Reconnect and review the testnet borrow again.");
  }
  const freshQuote = await quoteMezoTroveOpen(
    provider,
    borrower,
    BigInt(reviewedQuote.collateralAtomic)
  );
  if (!sameReviewedTerms(reviewedQuote, freshQuote)) {
    throw new Error("Mezo's price, borrowing terms, or gas estimate changed after review. Refresh the quote before signing.");
  }
  const { walletClient, publicClient } = createClients(provider);
  const blockNumber = await publicClient.getBlockNumber();
  const currentMusdBalance = await publicClient.readContract({
    address: MEZO_TESTNET_MUSD,
    abi: musdAbi,
    functionName: "balanceOf",
    args: [borrower],
    blockNumber
  });
  if (currentMusdBalance >= requiredMusd) {
    throw new Error("This wallet now has enough MUSD to pay the invoice. No trove was opened.");
  }
  if (BigInt(freshQuote.principalAtomic) < requiredMusd - currentMusdBalance) {
    throw new Error("The current minimum borrow would not cover the invoice shortfall. No trove was opened.");
  }
  onProgress("Review the BorrowerOperations transaction in your wallet. No invoice payment will be submitted.");
  const hash = await walletClient.writeContract({
    account: borrower,
    address: MEZO_TESTNET_BORROWER_OPERATIONS,
    abi: borrowerOperationsAbi,
    functionName: "openTrove",
    args: [BigInt(freshQuote.principalAtomic), zeroAddress, zeroAddress],
    value: BigInt(freshQuote.collateralAtomic)
  });
  onProgress(`Borrow transaction submitted (${hash}). Waiting for Mezo Testnet confirmation…`);
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
      pollingInterval: 2_000
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "receipt unavailable";
    throw new Error(`Borrow transaction ${hash} was submitted, but confirmation is still pending: ${message}`);
  }
  if (receipt.status !== "success") {
    throw new Error(`Borrow transaction ${hash} reverted on Mezo Testnet. No invoice payment was submitted.`);
  }
  let musdBalance: bigint;
  try {
    musdBalance = await publicClient.readContract({
      address: MEZO_TESTNET_MUSD,
      abi: musdAbi,
      functionName: "balanceOf",
      args: [borrower]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "balance unavailable";
    throw new Error(`Trove opening confirmed (${hash}), but the MUSD balance could not be refreshed: ${message}`);
  }
  return { hash, musdBalanceAtomic: musdBalance.toString() };
}
