import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { getAddress } from "viem";

type Eip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const network = "eip155:31611";
const musdAddress = getAddress("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
const permit2Address = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const allowanceSelector = "0xdd62ed3e";
const approveSelector = "0x095ea7b3";

async function ensureMezoTestnet(provider: Eip1193Provider): Promise<void> {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (String(chainId).toLowerCase() === "0x7b7b") {
    return;
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7b7b" }]
    });
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 4902) {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x7b7b",
        chainName: "Mezo Testnet",
        nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
        rpcUrls: ["https://rpc.test.mezo.org"],
        blockExplorerUrls: ["https://explorer.test.mezo.org"]
      }]
    });
  }
}

export async function ensurePermit2Allowance(
  provider: Eip1193Provider,
  address: `0x${string}`,
  requirements: ReturnType<x402HTTPClient["getPaymentRequiredResponse"]>,
  onProgress: (message: string) => void
): Promise<void> {
  const payment = requirements.accepts.find((candidate) =>
    candidate.scheme === "exact" &&
    candidate.network === network &&
    getAddress(candidate.asset) === musdAddress &&
    candidate.extra?.assetTransferMethod === "permit2"
  );
  if (!payment) {
    throw new Error("The protected resource did not request the configured Mezo MUSD Permit2 payment.");
  }
  const amount = BigInt(payment.amount);
  if (amount <= 0n) {
    throw new Error("The protected resource requested an invalid MUSD amount.");
  }
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  const amountLabel = `${whole}${fraction ? `.${fraction}` : ""} MUSD`;
  const allowanceData = `${allowanceSelector}${address.slice(2).toLowerCase().padStart(64, "0")}${permit2Address.slice(2).toLowerCase().padStart(64, "0")}`;
  const allowanceResult = await provider.request({
    method: "eth_call",
    params: [{ to: musdAddress, data: allowanceData }, "latest"]
  });
  if (typeof allowanceResult !== "string" || !/^0x[0-9a-fA-F]+$/.test(allowanceResult)) {
    throw new Error("Could not read the MUSD Permit2 allowance from your wallet.");
  }
  if (BigInt(allowanceResult) >= amount) {
    return;
  }

  onProgress(`Approve exactly ${amountLabel} for this payment. This approval transaction uses Mezo BTC for gas.`);
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: address,
      to: musdAddress,
      value: "0x0",
      data: `${approveSelector}${permit2Address.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`
    }]
  });
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Your wallet returned an invalid MUSD approval transaction hash.");
  }

  onProgress("Waiting for the MUSD approval transaction to confirm on Mezo Testnet…");
  let receipt: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    });
    if (receipt !== null) {
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  if (typeof receipt !== "object" || receipt === null || !("status" in receipt)) {
    throw new Error(`MUSD approval was not confirmed within 120 seconds. Transaction: ${txHash}`);
  }
  if (receipt.status !== "0x1") {
    throw new Error(`MUSD approval transaction failed on Mezo Testnet. Transaction: ${txHash}`);
  }

  const confirmedAllowance = await provider.request({
    method: "eth_call",
    params: [{ to: musdAddress, data: allowanceData }, "latest"]
  });
  if (
    typeof confirmedAllowance !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(confirmedAllowance) ||
    BigInt(confirmedAllowance) < amount
  ) {
    throw new Error("The confirmed approval did not grant the exact MUSD allowance required for this payment.");
  }
}

export async function payForRelayguardResource(
  endpoint: string,
  onProgress: (message: string) => void = () => undefined
): Promise<{
  readonly body: unknown;
  readonly settlement: string;
}> {
  const provider = window.ethereum;
  if (!provider) {
    throw new Error("Open RelayGuard in a browser with an EVM wallet to pay the protected resource.");
  }

  await ensureMezoTestnet(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("Wallet did not return a connected account.");
  }
  const address = getAddress(accounts[0]);
  const signer: ClientEvmSigner = {
    address,
    async signTypedData(typedData) {
      const serialized = JSON.stringify(typedData, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
      );
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, serialized]
      });
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
        throw new Error("Wallet returned an invalid typed-data signature.");
      }
      return signature as `0x${string}`;
    }
  };
  const client = new x402HTTPClient(
    new x402Client().register(network, new ExactEvmScheme(signer))
  );

  const unpaid = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (unpaid.status !== 402) {
    throw new Error(`Expected HTTP 402 from the protected resource; received ${unpaid.status}.`);
  }
  const unpaidBody: unknown = await unpaid.json();
  const requirements = client.getPaymentRequiredResponse(
    (name) => unpaid.headers.get(name),
    unpaidBody
  );
  await ensurePermit2Allowance(provider, address, requirements, onProgress);
  onProgress("Review the exact MUSD payment in your wallet and sign to access the resource…");
  const payload = await client.createPaymentPayload(requirements);
  onProgress("Submitting the signed payment to the Mezo facilitator…");
  const paid = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      ...client.encodePaymentSignatureHeader(payload)
    }
  });
  const contentType = paid.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json")
    ? await paid.json()
    : await paid.text();
  if (!paid.ok) {
    const paymentResult = client.parsePaymentResult({
      status: paid.status,
      getHeader: (name) => paid.headers.get(name),
      body
    });
    const protocolError = paymentResult.header
      ? "success" in paymentResult.header
        ? paymentResult.header.errorReason || paymentResult.header.errorMessage
        : paymentResult.header.error
      : undefined;
    const bodyError =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined;
    throw new Error(
      protocolError || bodyError ||
        (typeof body === "string" && body.trim()
          ? body.trim().slice(0, 240)
          : undefined) ||
        `Payment was not accepted (HTTP ${paid.status}).`
    );
  }
  const result = await client.processPaymentResult(
    payload,
    (name) => paid.headers.get(name),
    paid.status
  );
  if (!result.settleResponse?.success) {
    throw new Error("The facilitator did not confirm successful MUSD settlement.");
  }
  return {
    body,
    settlement: result.settleResponse.transaction
  };
}
