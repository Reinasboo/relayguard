import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  isAddress,
  TransactionReceiptNotFoundError,
  parseAbi
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezo, mezoTestnet } from "viem/chains";
import type { PaymentIntent } from "../core/domain.js";
import { BaseAdapter } from "./base.js";
import type { AdapterResult, PreparedPayment, SettlementEvidence } from "./contract.js";

const mezoTransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)"
]);

export interface MezoAdapterConfig {
  readonly rpcUrl?: string;
  readonly network?: "mainnet" | "testnet" | "mezo" | "mezoTestnet";
  readonly signerPrivateKey?: string;
  readonly signerAddress?: string;
  readonly tokenAddress?: string;
}

const erc20TransferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

async function readSettlementEvidence(
  reference: string,
  config: Partial<MezoAdapterConfig>,
  fallbackRpcUrl?: string
): Promise<AdapterResult<SettlementEvidence>> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(reference)) {
    return {
      supported: false,
      code: "not_configured",
      message: "Mezo settlement verification requires a 32-byte transaction hash."
    };
  }
  try {
    const { rpcUrl, chain } = resolveConfig(config, fallbackRpcUrl);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });
    const hash = reference as `0x${string}`;
    const receipt = await publicClient.getTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      return {
        supported: true,
        value: {
          state: "failed",
          reference,
          observedAt: Date.now(),
          source: `${chain.name} receipt`
        }
      };
    }

    const tokenAddress = config.tokenAddress;
    if (tokenAddress && receipt.to?.toLowerCase() === tokenAddress.toLowerCase()) {
      let transfer: { readonly to: string; readonly value: bigint } | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
        try {
          const event = decodeEventLog({
            abi: erc20TransferEventAbi,
            data: log.data,
            topics: log.topics
          });
          if (
            event.eventName === "Transfer" &&
            event.args.from.toLowerCase() === receipt.from.toLowerCase()
          ) {
            transfer = event.args;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!transfer) {
        return {
          supported: true,
          value: {
            state: "failed",
            reference,
            observedAt: Date.now(),
            source: `${chain.name} MUSD Transfer event`,
            asset: "MUSD",
            sender: receipt.from
          }
        };
      }
      return {
        supported: true,
        value: {
          state: "confirmed",
          reference,
          observedAt: Date.now(),
          source: `${chain.name} MUSD Transfer event`,
          asset: "MUSD",
          sender: receipt.from,
          recipient: transfer?.to,
          amountAtomic: transfer?.value.toString()
        }
      };
    }

    const transaction = await publicClient.getTransaction({ hash });
    if (!transaction.to) {
      return {
        supported: true,
        value: {
          state: "failed",
          reference,
          observedAt: Date.now(),
          source: `${chain.name} receipt`,
          asset: "unknown"
        }
      };
    }

    if (transaction.value > 0n) {
      return {
        supported: true,
        value: {
          state: "confirmed",
          reference,
          observedAt: Date.now(),
          source: `${chain.name} native transaction`,
          asset: "BTC",
          sender: transaction.from,
          recipient: transaction.to,
          amountAtomic: transaction.value.toString()
        }
      };
    }

    return {
      supported: true,
      value: {
        state: "failed",
        reference,
        observedAt: Date.now(),
        source: `${chain.name} receipt did not evidence a supported transfer`,
        asset: "unknown"
      }
    };
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return {
        supported: true,
        value: {
          state: "pending",
          reference,
          observedAt: Date.now(),
          source: "Mezo RPC (receipt not available yet)"
        }
      };
    }
    return {
      supported: false,
      code: "execution_failed",
      message: error instanceof Error ? error.message : "Mezo settlement verification failed."
    };
  }
}

function resolveConfig(
  config: Partial<MezoAdapterConfig> | undefined,
  fallbackRpcUrl?: string
): {
  rpcUrl: string;
  chain: typeof mezo | typeof mezoTestnet;
  network: "mainnet" | "testnet";
  signerPrivateKey: `0x${string}` | undefined;
} {
  const networkName = (config?.network ?? "testnet").toLowerCase();
  const isTestnet = networkName === "testnet" || networkName === "mezotestnet";
  if (!isTestnet && networkName !== "mainnet" && networkName !== "mezo") {
    throw new Error(`Unsupported Mezo network '${networkName}'.`);
  }
  const chain = isTestnet ? mezoTestnet : mezo;
  const rpcUrl = config?.rpcUrl ?? fallbackRpcUrl ?? chain.rpcUrls.default.http[0];
  if (!rpcUrl) {
    throw new Error("Mezo requires an RPC URL or a default Mezo chain endpoint.");
  }
  return {
    rpcUrl,
    chain,
    network: isTestnet ? "testnet" : "mainnet",
    signerPrivateKey: config?.signerPrivateKey ? (config.signerPrivateKey as `0x${string}`) : undefined
  };
}

export class MezoAdapter extends BaseAdapter {
  readonly identity = {
    id: "mezo" as const,
    name: "Mezo",
    contractVersion: "1.0.0" as const,
    capabilities: ["prepare_payment", "execute_payment", "lookup_status", "verify_settlement"] as const
  };

  constructor() {
    super(["rpcUrl", "network"]);
  }

  async prepare(
    intent: PaymentIntent,
    signal?: AbortSignal,
    config: Partial<MezoAdapterConfig> = {}
  ): Promise<AdapterResult<PreparedPayment>> {
    try {
      if (intent.network !== "mezo") {
        return this.unsupported("Mezo only accepts the 'mezo' network identifier.");
      }
      if (!isAddress(intent.recipient)) {
        return this.unsupported(`Recipient '${intent.recipient}' is not a valid Mezo EVM address.`);
      }
      if (intent.asset !== "BTC" && intent.asset !== "MUSD") {
        return this.unsupported("Mezo supports native BTC and configured MUSD transfers only.");
      }
      if (!/^(0|[1-9][0-9]*)$/.test(intent.amountAtomic) || BigInt(intent.amountAtomic) <= 0n) {
        return this.unsupported("Mezo payment amount must be a positive base-unit integer.");
      }
      const { rpcUrl, chain, network } = resolveConfig(config, process.env.MEZO_RPC_URL);
      if (signal?.aborted) {
        return this.unsupported("Mezo payment preparation was aborted before execution.");
      }
      const action = intent.asset.toUpperCase();
      const tokenAddress = config.tokenAddress;
      if (action === "MUSD" && !tokenAddress) {
        return this.unconfigured("MUSD transfers require the configured token contract address for the selected Mezo network.");
      }
      if (action === "MUSD" && !isAddress(tokenAddress ?? "")) {
        return this.unconfigured("The configured MUSD contract address is invalid.");
      }
      const amount = BigInt(intent.amountAtomic);
      const prepared: PreparedPayment = {
        intent,
        adapterData: {
          rpcUrl,
          chainId: String(chain.id),
          network,
          asset: action,
          tokenAddress: tokenAddress ?? "",
          recipient: intent.recipient,
          amountAtomic: intent.amountAtomic,
          method: action === "MUSD" ? "erc20-transfer" : "native-transfer",
          value: String(amount),
          preparedAt: String(Date.now())
        }
      };
      return { supported: true, value: prepared };
    } catch (error) {
      return this.unconfigured(
        error instanceof Error ? error.message : "Mezo payment preparation failed because the environment was not configured for a valid network.")
    }
  }

  async execute(
    prepared: PreparedPayment,
    signal?: AbortSignal,
    config: Partial<MezoAdapterConfig> = {}
  ): Promise<AdapterResult<{ readonly reference: string }>> {
    try {
      const { rpcUrl, chain, network, signerPrivateKey } = resolveConfig(config, process.env.MEZO_RPC_URL);
      if (signerPrivateKey === undefined) {
        return this.unconfigured("Mezo execution requires MEZO_PRIVATE_KEY or signerPrivateKey to sign the transaction.");
      }
      if (signal?.aborted) {
        return this.unsupported("Mezo transaction execution was aborted before signing.");
      }
      if (
        prepared.intent.network !== "mezo" ||
        prepared.adapterData.network !== network ||
        prepared.adapterData.chainId !== String(chain.id) ||
        prepared.adapterData.amountAtomic !== prepared.intent.amountAtomic ||
        prepared.adapterData.recipient !== prepared.intent.recipient
      ) {
        return this.unsupported("Prepared Mezo payment does not match the configured network or original intent.");
      }
      const amountAtomic = prepared.adapterData.amountAtomic;
      if (!amountAtomic || !/^[1-9][0-9]*$/.test(amountAtomic)) {
        return this.unsupported("Prepared Mezo payment contains an invalid amount.");
      }
      const amount = BigInt(amountAtomic);
      const recipient = prepared.intent.recipient;
      const asset = prepared.adapterData.asset ?? "MEZO";
      if ((asset !== "BTC" && asset !== "MUSD") || asset !== prepared.intent.asset) {
        return this.unsupported("Prepared Mezo payment contains an unsupported or mismatched asset.");
      }
      if (!isAddress(recipient)) {
        return this.unsupported("Prepared Mezo payment contains an invalid recipient address.");
      }
      const account = privateKeyToAccount(signerPrivateKey);
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl)
      });
      let hash: `0x${string}`;
      if (asset === "MUSD" && prepared.adapterData.tokenAddress && isAddress(prepared.adapterData.tokenAddress)) {
        hash = await walletClient.writeContract({
          address: prepared.adapterData.tokenAddress,
          abi: mezoTransferAbi,
          functionName: "transfer",
          args: [recipient as `0x${string}`, amount],
          account,
          chain
        });
      } else {
        if (asset === "MUSD") {
          return this.unconfigured("MUSD execution requires a valid prepared token contract address.");
        }
        hash = await walletClient.sendTransaction({
          account,
          chain,
          to: recipient as `0x${string}`,
          value: amount
        });
      }
      return { supported: true, value: { reference: hash } };
    } catch (error) {
      return this.executionFailed(
        error instanceof Error ? error.message : "Mezo transaction execution failed.")
    }
  }

  async lookupStatus(
    reference: string,
    _signal?: AbortSignal,
    config: Partial<MezoAdapterConfig> = {}
  ): Promise<AdapterResult<SettlementEvidence>> {
    return readSettlementEvidence(reference, config, process.env.MEZO_RPC_URL);
  }

  async verifySettlement(
    reference: string,
    _signal?: AbortSignal,
    config: Partial<MezoAdapterConfig> = {}
  ): Promise<AdapterResult<SettlementEvidence>> {
    return readSettlementEvidence(reference, config, process.env.MEZO_RPC_URL);
  }
}
