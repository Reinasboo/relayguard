import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  parseUnits,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "viem/chains";
import { AuthorizationService } from "./core/authorization.js";
import { CheckoutService } from "./core/checkout.js";
import { PostgresAuthorizationService, PostgresCheckoutService } from "./core/postgres.js";
import type { AuthorizationStore, CheckoutStore } from "./core/stores.js";
import type { PaymentIntent, SpendingPolicy } from "./core/domain.js";
import { MezoAdapter } from "./adapters/mezo.js";
import type { PreparedPayment } from "./adapters/contract.js";
import QRCode from "qrcode";

loadDotenv({ path: ".env.app.local", override: true });

const port = Number(process.env.PORT ?? "4173");
const host = process.env.HOST ?? "127.0.0.1";
const rpcUrl = process.env.MEZO_RPC_URL ?? mezoTestnet.rpcUrls.default.http[0];
const network = process.env.MEZO_NETWORK ?? "testnet";
const signerPrivateKey = process.env.MEZO_PRIVATE_KEY;
const configuredSigner = process.env.MEZO_SIGNER_ADDRESS;
const configuredRecipients = (process.env.MEZO_ALLOWED_RECIPIENTS ?? "")
  .split(",")
  .map((recipient) => recipient.trim())
  .filter(Boolean);
const approverId = process.env.MEZO_APPROVER_ID ?? "local-operator";
const merchantName = process.env.MEZO_MERCHANT_NAME ?? "RelayGuard Test Merchant";
const merchantAddressConfig = process.env.MEZO_MERCHANT_ADDRESS ?? "";
const databasePath = process.env.RELAYGUARD_DATABASE_PATH ?? "./data/relayguard.sqlite";
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : undefined;
const x402Enabled = process.env.X402_ENABLED === "true";
const x402PayTo = process.env.X402_PAY_TO ?? "";
const x402Price = process.env.X402_PRICE ?? "$0.001";
const x402FacilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://facilitator.vativ.io";
const adapter = new MezoAdapter();
if (process.env.VERCEL && !databaseUrl) {
  throw new Error("DATABASE_URL must be configured for the Vercel runtime.");
}
const authorization: AuthorizationStore = databaseUrl
  ? new PostgresAuthorizationService(databaseUrl)
  : new AuthorizationService(databasePath);
const checkout: CheckoutStore = databaseUrl
  ? new PostgresCheckoutService(databaseUrl)
  : new CheckoutService(databasePath);
const storageReady = Promise.all([authorization.ready(), checkout.ready()]).then(() => undefined);
const pendingPayments = new Map<string, PreparedPayment>();
const publicClient = createPublicClient({
  chain: mezoTestnet,
  transport: http(rpcUrl)
});
let musdDetailsPromise: Promise<{ decimals: number; tokenAddress: Address }> | undefined;
const erc20ReadAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }]
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (host !== "127.0.0.1" && host !== "0.0.0.0" && host !== "::") {
  throw new Error("HOST must be a supported bind address.");
}
if (network.toLowerCase() !== "testnet") {
  throw new Error("This demo server is deliberately restricted to Mezo testnet.");
}
if (!signerPrivateKey || !isHex(signerPrivateKey) || signerPrivateKey.length !== 66) {
  throw new Error("MEZO_PRIVATE_KEY must be a 32-byte hex private key to start the Mezo demo server.");
}

const account = privateKeyToAccount(signerPrivateKey);
const signerAddress = account.address;
if (configuredSigner && getAddress(configuredSigner) !== signerAddress) {
  throw new Error("MEZO_SIGNER_ADDRESS does not match the address derived from MEZO_PRIVATE_KEY.");
}
const allowedRecipients = configuredRecipients.map((recipient) => {
  if (!isAddress(recipient)) {
    throw new Error(`MEZO_ALLOWED_RECIPIENTS contains an invalid EVM address: ${recipient}`);
  }
  return getAddress(recipient);
});
const merchantAddress = merchantAddressConfig
  ? getAddress(merchantAddressConfig)
  : undefined;
if (merchantAddress && !allowedRecipients.some((recipient) => recipient === merchantAddress)) {
  throw new Error("MEZO_MERCHANT_ADDRESS must also appear in MEZO_ALLOWED_RECIPIENTS.");
}
if (x402Enabled && (!isAddress(x402PayTo) || !/^\$\d+(?:\.\d{1,18})?$/.test(x402Price))) {
  throw new Error("Enabled x402 requires a valid X402_PAY_TO address and X402_PRICE such as $0.001.");
}

async function authenticatedUserId(req: IncomingMessage): Promise<string | undefined> {
  const bearer = req.headers.authorization;
  const token = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : undefined;
  if (!token || !supabase) {
    return undefined;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return undefined;
  }
  return data.user.id;
}

function response(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      throw new Error("Request body exceeds the 16 KB limit.");
    }
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function policyFor(asset: "BTC" | "MUSD", decimals: number): SpendingPolicy {
  const defaults =
    asset === "BTC"
      ? { max: "0.001", daily: "0.005", approval: "0.0005" }
      : { max: "25", daily: "100", approval: "10" };
  const prefix = asset === "BTC" ? "MEZO" : "MEZO_MUSD";
  const max = process.env[`${prefix}_MAX_TRANSACTION`] ?? defaults.max;
  const daily = process.env[`${prefix}_DAILY_LIMIT`] ?? defaults.daily;
  const approval = process.env[`${prefix}_APPROVAL_THRESHOLD`] ?? defaults.approval;
  return {
    id: `mezo-testnet-${asset.toLowerCase()}`,
    version: 1,
    agentId: process.env.MEZO_AGENT_ID ?? "relayguard-demo-agent",
    network: "mezo",
    asset,
    maxTransactionAtomic: parseUnits(max, decimals).toString(),
    dailyLimitAtomic: parseUnits(daily, decimals).toString(),
    approvalThresholdAtomic: parseUnits(approval, decimals).toString(),
    allowedRecipients,
    approverIds: [approverId]
  };
}

async function assetDetails(asset: string): Promise<{ decimals: number; tokenAddress?: Address }> {
  if (asset === "BTC") {
    return { decimals: mezoTestnet.nativeCurrency.decimals };
  }
  if (asset !== "MUSD") {
    throw new Error("Supported demo assets are native BTC and configured MUSD.");
  }
  const tokenAddress = process.env.MEZO_TOKEN_ADDRESS;
  if (!tokenAddress || !isAddress(tokenAddress)) {
    throw new Error("MUSD is unavailable: set MEZO_TOKEN_ADDRESS to the verified Mezo testnet MUSD contract.");
  }
  if (!musdDetailsPromise) {
    const address = getAddress(tokenAddress);
    const details = Promise.all([
      publicClient.readContract({ address, abi: erc20ReadAbi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20ReadAbi, functionName: "decimals" })
    ]).then(([symbol, decimals]) => {
      if (symbol.toUpperCase() !== "MUSD") {
        throw new Error(`Configured token contract reports symbol '${symbol}', not MUSD.`);
      }
      return { decimals, tokenAddress: address };
    });
    musdDetailsPromise = details.catch((error: unknown) => {
      musdDetailsPromise = undefined;
      throw error;
    });
  }
  return musdDetailsPromise;
}

function localOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    const publicOrigins = [
      process.env.PUBLIC_ORIGIN,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined
    ].filter((value): value is string => Boolean(value));
    if (publicOrigins.includes(url.origin)) {
      return true;
    }
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      Number(url.port || (url.protocol === "https:" ? "443" : "80")) === port
    );
  } catch {
    return false;
  }
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProtocol = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProtocol === "string" && /^https?$/.test(forwardedProtocol)
      ? forwardedProtocol
      : process.env.VERCEL
        ? "https"
        : "http";
  const hostHeader = req.headers.host;
  const host = typeof hostHeader === "string" ? hostHeader.trim() : undefined;
  if (!host) {
    throw new Error("Request host is unavailable.");
  }
  return new URL(`${protocol}://${host}`).origin;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!localOriginAllowed(req)) {
    response(res, 403, { error: "Cross-origin requests are not allowed." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    response(res, 200, {
      supabase: supabase
        ? {
            url: supabaseUrl,
            publishableKey: supabasePublishableKey,
            redirectUrl:
              process.env.SUPABASE_REDIRECT_URL ??
              (process.env.VERCEL_PROJECT_PRODUCTION_URL
                ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/`
                : `${requestOrigin(req)}/`)
          }
        : null,
      x402: {
        enabled: x402Enabled,
        price: x402Price,
        payTo: x402Enabled ? getAddress(x402PayTo) : merchantAddress ?? null,
        network: "eip155:31611",
        endpoint: "/api/paid-resource"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/paid-resource") {
    if (!x402Enabled) {
      response(res, 503, { error: "The x402 MUSD endpoint is not enabled on this server." });
      return;
    }
    response(res, 200, {
      ok: true,
      product: "RelayGuard",
      message: "MUSD payment settled; this protected Mezo resource is unlocked."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const [chainId, blockNumber, balance] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: signerAddress })
    ]);
    if (chainId !== mezoTestnet.id) {
      response(res, 503, { error: `RPC chain ID mismatch: expected ${mezoTestnet.id}, received ${chainId}.` });
      return;
    }
    let musd: { address: string; balanceAtomic: string; decimals: number } | null = null;
    const tokenAddress = process.env.MEZO_TOKEN_ADDRESS;
    if (tokenAddress && isAddress(tokenAddress)) {
      try {
        const details = await assetDetails("MUSD");
        if (details.tokenAddress) {
          const tokenBalance = await publicClient.readContract({
            address: details.tokenAddress,
            abi: erc20ReadAbi,
            functionName: "balanceOf",
            args: [signerAddress]
          });
          musd = {
            address: details.tokenAddress,
            balanceAtomic: tokenBalance.toString(),
            decimals: details.decimals
          };
        }
      } catch (error) {
        musd = null;
        console.error("Could not read configured MUSD contract:", error);
      }
    }
    response(res, 200, {
      status: "ready",
      network: mezoTestnet.name,
      chainId,
      blockNumber: blockNumber.toString(),
      rpcUrl,
      wallet: signerAddress,
      nativeAsset: mezoTestnet.nativeCurrency.symbol,
      nativeBalanceAtomic: balance.toString(),
      nativeBalance: formatUnits(balance, mezoTestnet.nativeCurrency.decimals),
      musd,
      signingReady: Boolean(signerPrivateKey),
      policy: {
        configuredRecipients: allowedRecipients,
        approverId,
        transactionLimit: process.env.MEZO_MAX_TRANSACTION ?? "asset default",
        dailyLimit: process.env.MEZO_DAILY_LIMIT ?? "asset default",
        approvalThreshold: process.env.MEZO_APPROVAL_THRESHOLD ?? "asset default"
      }
    });
    return;
  }

  const operatorApi =
    url.pathname === "/api/audit" ||
    url.pathname === "/api/payments" ||
    /^\/api\/payments\/[^/]+(?:\/(?:approve|reject|execute|verify))?$/.test(url.pathname);
  if (operatorApi && !(await authenticatedUserId(req))) {
    response(res, 401, { error: "Sign in with your RelayGuard merchant account to access payment controls." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    const [verified, events] = await Promise.all([
      authorization.verifyAuditChain(),
      authorization.auditEvents()
    ]);
    response(res, 200, {
      verified,
      events: events.slice(-50).reverse()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/merchant") {
    response(res, 200, {
      name: merchantName,
      address: merchantAddress ?? null,
      asset: "MUSD",
      tokenAddress: process.env.MEZO_TOKEN_ADDRESS ?? null
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/invoices") {
    const userId = await authenticatedUserId(req);
    if (!userId) {
      response(res, 401, { error: "Sign in to manage merchant invoices." });
      return;
    }
    response(res, 200, { invoices: await checkout.list(userId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/invoices") {
    const body = await readJson(req);
    const userId = await authenticatedUserId(req);
    if (!userId) {
      response(res, 401, { error: "Sign in to create merchant invoices." });
      return;
    }
    if (!merchantAddress || !allowedRecipients.includes(merchantAddress)) {
      response(res, 503, { error: "Set MEZO_MERCHANT_ADDRESS to a valid address in MEZO_ALLOWED_RECIPIENTS before creating merchant invoices." });
      return;
    }
    if (typeof body.amount !== "string" || typeof body.description !== "string") {
      response(res, 400, { error: "Invoice amount and description are required." });
      return;
    }
    const details = await assetDetails("MUSD");
    const amountAtomic = parseUnits(body.amount.trim(), details.decimals);
    if (amountAtomic <= 0n) {
      response(res, 400, { error: "Invoice amount must be greater than zero." });
      return;
    }
    const description = body.description.trim().slice(0, 120);
    if (!description) {
      response(res, 400, { error: "Invoice description cannot be empty." });
      return;
    }
    const expiresInHours = typeof body.expiresInHours === "number" ? body.expiresInHours : 24;
    if (!Number.isFinite(expiresInHours) || expiresInHours < 0.25 || expiresInHours > 168) {
      response(res, 400, { error: "Invoice expiry must be between 0.25 and 168 hours." });
      return;
    }
    const invoice = await checkout.create({
      merchantUserId: userId,
      merchantName,
      merchantAddress,
      amountAtomic: amountAtomic.toString(),
      description,
      expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000
    });
    const baseUrl = requestOrigin(req);
    response(res, 201, {
      invoice,
      checkoutUrl: `${baseUrl}/pay/${invoice.id}`,
      qrUrl: `/api/invoices/${invoice.id}/qr`
    });
    return;
  }

  const invoiceQrMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/qr$/);
  if (req.method === "GET" && invoiceQrMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceQrMatch[1] ?? ""));
    const image = await QRCode.toBuffer(`${requestOrigin(req)}/pay/${invoice.id}`, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#111820", light: "#ffffff" }
    });
    res.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(image);
    return;
  }

  const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (req.method === "GET" && invoiceMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceMatch[1] ?? ""));
    response(res, 200, { invoice });
    return;
  }

  const invoiceAuthorizeMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/authorize$/);
  if (req.method === "POST" && invoiceAuthorizeMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceAuthorizeMatch[1] ?? ""));
    const body = await readJson(req);
    if (typeof body.payerAddress !== "string" || !isAddress(body.payerAddress)) {
      response(res, 400, { error: "A valid Mezo testnet payer address is required." });
      return;
    }
    if (!merchantAddress || invoice.merchantAddress !== merchantAddress) {
      response(res, 409, { error: "Invoice merchant is not configured for this payment service." });
      return;
    }
    const payerAddress = getAddress(body.payerAddress);
    const payerId = `checkout:${payerAddress.toLowerCase()}`;
    if (invoice.status === "authorized" && invoice.authorizationId) {
      const existing = await authorization.get(invoice.authorizationId);
      if (existing.intent.agentId !== payerId) {
        response(res, 409, { error: "This invoice is already reserved by another payer." });
        return;
      }
      response(res, 200, { invoice, authorization: existing, replayed: true });
      return;
    }
    const details = await assetDetails("MUSD");
    if (!details.tokenAddress) {
      response(res, 503, { error: "Verified MUSD contract is unavailable." });
      return;
    }
    const balance = await publicClient.readContract({
      address: details.tokenAddress,
      abi: erc20ReadAbi,
      functionName: "balanceOf",
      args: [payerAddress]
    });
    if (balance < BigInt(invoice.amountAtomic)) {
      response(res, 409, {
        error: "This wallet does not hold enough MUSD for this invoice.",
        code: "insufficient_musd",
        requiredAtomic: invoice.amountAtomic,
        balanceAtomic: balance.toString(),
        borrowGuide: "https://mezo.org/docs/users/borrow/mint-musd/"
      });
      return;
    }
    const intent: PaymentIntent = {
      agentId: payerId,
      network: "mezo",
      asset: "MUSD",
      recipient: invoice.merchantAddress,
      amountAtomic: invoice.amountAtomic,
      purpose: `Merchant checkout: ${invoice.description}`,
      idempotencyKey: `checkout:${invoice.id}:${payerAddress.toLowerCase()}`
    };
    const { approvalThresholdAtomic: _approvalThreshold, ...checkoutPolicy } = policyFor("MUSD", details.decimals);
    const policy: SpendingPolicy = {
      ...checkoutPolicy,
      agentId: payerId,
      allowedRecipients: [invoice.merchantAddress]
    };
    const result = await authorization.request(intent, policy);
    if (result.record.status !== "authorized") {
      response(res, 403, {
        error: result.record.reason ?? "Merchant checkout policy did not authorize this payment.",
        authorization: result.record
      });
      return;
    }
    const updatedInvoice = await checkout.authorize(invoice.id, result.record.id);
    response(res, 200, { invoice: updatedInvoice, authorization: result.record, replayed: result.replayed });
    return;
  }

  const invoiceSubmitMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/submit$/);
  if (req.method === "POST" && invoiceSubmitMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceSubmitMatch[1] ?? ""));
    const body = await readJson(req);
    if (
      typeof body.authorizationId !== "string" ||
      typeof body.transactionHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(body.transactionHash)
    ) {
      response(res, 400, { error: "Authorization ID and a 32-byte transaction hash are required." });
      return;
    }
    const record = await authorization.get(body.authorizationId);
    if (
      invoice.status !== "authorized" ||
      invoice.authorizationId !== record.id ||
      record.status !== "authorized" ||
      record.intent.asset !== "MUSD" ||
      record.intent.recipient.toLowerCase() !== invoice.merchantAddress.toLowerCase() ||
      record.intent.amountAtomic !== invoice.amountAtomic
    ) {
      response(res, 409, { error: "Invoice and policy authorization do not match." });
      return;
    }
    await authorization.markExecuting(record.id);
    const submitted = await authorization.markSubmitted(record.id, Date.now(), body.transactionHash);
    const updatedInvoice = await checkout.submit(invoice.id, record.id, body.transactionHash);
    response(res, 200, { invoice: updatedInvoice, authorization: submitted });
    return;
  }

  const invoiceReleaseMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/release$/);
  if (req.method === "POST" && invoiceReleaseMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceReleaseMatch[1] ?? ""));
    const body = await readJson(req);
    if (typeof body.authorizationId !== "string" || typeof body.payerAddress !== "string" || !isAddress(body.payerAddress)) {
      response(res, 400, { error: "Authorization ID and valid payer address are required." });
      return;
    }
    const record = await authorization.get(body.authorizationId);
    if (
      invoice.status !== "authorized" ||
      invoice.authorizationId !== record.id ||
      record.status !== "authorized" ||
      record.intent.agentId !== `checkout:${getAddress(body.payerAddress).toLowerCase()}`
    ) {
      response(res, 409, { error: "Only the same payer can release an unsubmitted invoice authorization." });
      return;
    }
    await authorization.cancel(record.id);
    const released = await checkout.release(invoice.id, record.id);
    response(res, 200, { invoice: released });
    return;
  }

  const invoiceVerifyMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/verify$/);
  if (req.method === "POST" && invoiceVerifyMatch) {
    const invoice = await checkout.get(decodeURIComponent(invoiceVerifyMatch[1] ?? ""));
    if (invoice.status === "paid" || invoice.status === "failed") {
      response(res, 200, { invoice, message: `Invoice is already ${invoice.status}.` });
      return;
    }
    if (invoice.status !== "submitted" || !invoice.authorizationId || !invoice.transactionReference) {
      response(res, 409, { error: `Invoice cannot be verified from state '${invoice.status}'.` });
      return;
    }
    const record = await authorization.get(invoice.authorizationId);
    const details = await assetDetails("MUSD");
    const evidence = await adapter.verifySettlement(invoice.transactionReference, undefined, {
      rpcUrl,
      network: "testnet",
      ...(details.tokenAddress ? { tokenAddress: details.tokenAddress } : {})
    });
    if (!evidence.supported) {
      response(res, 502, { error: evidence.message, invoice });
      return;
    }
    if (evidence.value.state === "pending") {
      response(res, 202, { invoice, evidence: evidence.value, message: "Waiting for the Mezo receipt." });
      return;
    }
    if (
      evidence.value.state === "confirmed" &&
      evidence.value.asset === record.intent.asset &&
      evidence.value.sender?.toLowerCase() === record.intent.agentId.replace(/^checkout:/, "") &&
      evidence.value.recipient?.toLowerCase() === record.intent.recipient.toLowerCase() &&
      evidence.value.amountAtomic === record.intent.amountAtomic
    ) {
      const confirmed = await authorization.markConfirmed(record.id);
      const paid = await checkout.settle(invoice.id, "paid");
      response(res, 200, { invoice: paid, authorization: confirmed, evidence: evidence.value });
      return;
    }
    const reason = "Mezo receipt did not evidence the exact authorized MUSD payment.";
    const failed = await authorization.markFailed(record.id, reason);
    const failedInvoice = await checkout.settle(invoice.id, "failed");
    response(res, 200, { invoice: failedInvoice, authorization: failed, evidence: evidence.value });
    return;
  }

  const getPaymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/);
  if (req.method === "GET" && getPaymentMatch) {
    const recordId = decodeURIComponent(getPaymentMatch[1] ?? "");
    const record = await authorization.get(recordId);
    response(res, 200, { record });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments") {
    const body = await readJson(req);
    if (typeof body.asset !== "string" || typeof body.recipient !== "string" ||
        typeof body.amount !== "string" || typeof body.purpose !== "string") {
      response(res, 400, { error: "asset, recipient, amount, and purpose are required as strings." });
      return;
    }
    if (!allowedRecipients.length) {
      response(res, 503, { error: "No recipients are approved. Configure MEZO_ALLOWED_RECIPIENTS before requesting a payment." });
      return;
    }
    if (!isAddress(body.recipient)) {
      response(res, 400, { error: "Recipient must be a valid Mezo EVM address." });
      return;
    }
    const asset = body.asset.toUpperCase();
    const details = await assetDetails(asset);
    const recipient = getAddress(body.recipient);
    const amountAtomic = parseUnits(body.amount, details.decimals);
    if (amountAtomic <= 0n) {
      response(res, 400, { error: "Payment amount must be greater than zero." });
      return;
    }
    let signerBalance: bigint;
    if (asset === "BTC") {
      signerBalance = await publicClient.getBalance({ address: signerAddress });
    } else if (details.tokenAddress) {
      signerBalance = await publicClient.readContract({
        address: details.tokenAddress,
        abi: erc20ReadAbi,
        functionName: "balanceOf",
        args: [signerAddress]
      });
    } else {
      throw new Error("Configured MUSD token address is unavailable.");
    }
    if (signerBalance < amountAtomic) {
      response(res, 409, { error: `Insufficient ${asset} balance for this amount; no authorization was recorded.` });
      return;
    }
    const intent: PaymentIntent = {
      agentId: process.env.MEZO_AGENT_ID ?? "relayguard-demo-agent",
      network: "mezo",
      asset,
      recipient,
      amountAtomic: amountAtomic.toString(),
      purpose: body.purpose.trim().slice(0, 200),
      idempotencyKey:
        typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 128)
          : crypto.randomUUID()
    };
    const policy = policyFor(asset as "BTC" | "MUSD", details.decimals);
    const result = await authorization.request(intent, policy);
    if (result.record.status === "denied") {
      response(res, 403, { record: result.record, error: result.record.reason ?? "Policy denied this payment." });
      return;
    }
    if (result.record.status === "awaiting_approval") {
      response(res, 201, {
        record: result.record,
        approvalChallenge: result.approvalChallenge,
        replayed: result.replayed,
        message: "Human approval is required before this payment can be executed."
      });
      return;
    }
    const prepared = await adapter.prepare(intent, undefined, {
      rpcUrl,
      network: "testnet",
      ...(signerPrivateKey ? { signerPrivateKey } : {}),
      signerAddress,
      ...(details.tokenAddress ? { tokenAddress: details.tokenAddress } : {})
    });
    if (!prepared.supported) {
      await authorization.markFailed(result.record.id, prepared.message);
      response(res, 503, { error: prepared.message, record: await authorization.get(result.record.id) });
      return;
    }
    pendingPayments.set(result.record.id, prepared.value);
    response(res, 201, {
      record: result.record,
      replayed: result.replayed,
      message: "Policy authorized. Review the transaction, then explicitly execute it."
    });
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/approve$/);
  if (req.method === "POST" && approvalMatch) {
    const recordId = decodeURIComponent(approvalMatch[1] ?? "");
    const body = await readJson(req);
    if (typeof body.challenge !== "string") {
      response(res, 400, { error: "Approval challenge is required." });
      return;
    }
    const record = await authorization.get(recordId);
    const details = await assetDetails(record.intent.asset);
    const policy = policyFor(record.intent.asset as "BTC" | "MUSD", details.decimals);
    const approved = await authorization.approve(recordId, approverId, body.challenge, policy);
    const prepared = await adapter.prepare(approved.intent, undefined, {
      rpcUrl,
      network: "testnet",
      ...(signerPrivateKey ? { signerPrivateKey } : {}),
      signerAddress,
      ...(details.tokenAddress ? { tokenAddress: details.tokenAddress } : {})
    });
    if (!prepared.supported) {
      await authorization.markFailed(recordId, prepared.message);
      response(res, 503, { error: prepared.message, record: await authorization.get(recordId) });
      return;
    }
    pendingPayments.set(recordId, prepared.value);
    response(res, 200, { record: approved, message: "Approved. Execution remains a separate explicit action." });
    return;
  }

  const rejectMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const recordId = decodeURIComponent(rejectMatch[1] ?? "");
    const record = await authorization.get(recordId);
    const details = await assetDetails(record.intent.asset);
    const policy = policyFor(record.intent.asset as "BTC" | "MUSD", details.decimals);
    const rejected = await authorization.reject(recordId, approverId, policy);
    pendingPayments.delete(recordId);
    response(res, 200, { record: rejected, message: "Human rejected the exact payment intent." });
    return;
  }

  const executeMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/execute$/);
  if (req.method === "POST" && executeMatch) {
    const recordId = decodeURIComponent(executeMatch[1] ?? "");
    const record = await authorization.get(recordId);
    if (record.status !== "authorized") {
      response(res, 409, { error: `Payment cannot execute from state '${record.status}'.`, record });
      return;
    }
    let prepared = pendingPayments.get(recordId);
    if (!prepared) {
      const details = await assetDetails(record.intent.asset);
      const result = await adapter.prepare(record.intent, undefined, {
        rpcUrl,
        network: "testnet",
        ...(signerPrivateKey ? { signerPrivateKey } : {}),
        signerAddress,
        ...(details.tokenAddress ? { tokenAddress: details.tokenAddress } : {})
      });
      if (!result.supported) {
        await authorization.markFailed(recordId, result.message);
        response(res, 503, { error: result.message, record: await authorization.get(recordId) });
        return;
      }
      prepared = result.value;
    }
    const details = await assetDetails(record.intent.asset);
    let balance: bigint;
    if (record.intent.asset === "BTC") {
      balance = await publicClient.getBalance({ address: signerAddress });
    } else if (details.tokenAddress) {
      balance = await publicClient.readContract({
        address: details.tokenAddress,
        abi: erc20ReadAbi,
        functionName: "balanceOf",
        args: [signerAddress]
      });
    } else {
      throw new Error("Configured MUSD token address is unavailable.");
    }
    if (balance < BigInt(record.intent.amountAtomic)) {
      response(res, 409, { error: `Insufficient ${record.intent.asset} balance; transaction not submitted.`, record });
      return;
    }
    await authorization.markExecuting(recordId);
    const result = await adapter.execute(prepared, undefined, {
      rpcUrl,
      network: "testnet",
      ...(signerPrivateKey ? { signerPrivateKey } : {}),
      signerAddress,
      ...(process.env.MEZO_TOKEN_ADDRESS ? { tokenAddress: getAddress(process.env.MEZO_TOKEN_ADDRESS) } : {})
    });
    if (!result.supported) {
      const failed = await authorization.markFailed(recordId, result.message);
      response(res, 502, { error: result.message, record: failed });
      return;
    }
    const submitted = await authorization.markSubmitted(recordId, Date.now(), result.value.reference);
    pendingPayments.delete(recordId);
    response(res, 200, {
      record: submitted,
      transactionHash: result.value.reference,
      explorerUrl: `https://explorer.test.mezo.org/tx/${result.value.reference}`,
      message: "Submitted to Mezo testnet. Waiting for independently verified settlement."
    });
    return;
  }

  const verifyMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyMatch) {
    const recordId = decodeURIComponent(verifyMatch[1] ?? "");
    const record = await authorization.get(recordId);
    if (record.status !== "submitted") {
      response(res, 409, { error: `Payment cannot be verified from state '${record.status}'.`, record });
      return;
    }
    const reference = record.transactionReference;
    if (!reference) {
      response(res, 409, { error: "Transaction reference is not available in this server session.", record });
      return;
    }
    const evidence = await adapter.verifySettlement(reference, undefined, {
      rpcUrl,
      network: "testnet",
      ...(process.env.MEZO_TOKEN_ADDRESS ? { tokenAddress: getAddress(process.env.MEZO_TOKEN_ADDRESS) } : {})
    });
    if (!evidence.supported) {
      response(res, 502, { error: evidence.message, record });
      return;
    }
    if (
      evidence.value.state === "confirmed" &&
      evidence.value.asset === record.intent.asset &&
      evidence.value.sender?.toLowerCase() === signerAddress.toLowerCase() &&
      evidence.value.recipient &&
      getAddress(evidence.value.recipient) === getAddress(record.intent.recipient) &&
      evidence.value.amountAtomic === record.intent.amountAtomic
    ) {
      const confirmed = await authorization.markConfirmed(recordId);
      response(res, 200, { record: confirmed, evidence: evidence.value });
      return;
    }
    if (evidence.value.state === "failed" || evidence.value.state === "confirmed") {
      const failureReason =
        evidence.value.state === "failed"
          ? "Mezo receipt did not evidence a successful transfer."
          : "Mezo transaction receipt does not match the authorized payment intent.";
      const failed = await authorization.markFailed(recordId, failureReason);
      response(res, 200, { record: failed, evidence: evidence.value });
      return;
    }
    response(res, 202, { record, evidence: evidence.value, message: "Receipt not confirmed yet; verify again shortly." });
    return;
  }

  response(res, 404, { error: "Not found." });
}

const publicDirectory = resolve(process.cwd(), "public");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, _res, next) => {
  const route = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    .searchParams.get("__relayguard_path");
  if (route && /^\/(?:api|pay)\//.test(route)) {
    req.url = route;
    req.originalUrl = route;
  }
  next();
});

if (x402Enabled) {
  const facilitator = new HTTPFacilitatorClient({ url: x402FacilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(
    "eip155:31611",
    new ExactEvmScheme()
  );
  app.use(
    paymentMiddleware(
      {
        "GET /api/paid-resource": {
          accepts: {
            scheme: "exact",
            price: x402Price,
            network: "eip155:31611",
            payTo: getAddress(x402PayTo),
            maxTimeoutSeconds: 60
          },
          description: `RelayGuard protected resource — pay ${x402Price} in MUSD`,
          mimeType: "application/json"
        }
      },
      resourceServer,
      { appName: "RelayGuard", testnet: true },
      undefined
    )
  );
}

app.use(async (req: Request, res: Response) => {
  try {
    await storageReady;
    const hostHeader = req.headers.host ?? "";
    const hostName = hostHeader.replace(/:\d+$/, "").toLowerCase();
    const allowedPublicHosts = [
      process.env.PUBLIC_HOSTNAME,
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (
      !["localhost", "127.0.0.1", "::1"].includes(hostName) &&
      !allowedPublicHosts.includes(hostName) &&
      !(process.env.VERCEL && hostName.endsWith(".vercel.app"))
    ) {
      response(res, 403, { error: "This host is not configured for RelayGuard." });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${hostHeader || `${host}:${port}`}`);
    const relayguardPath = process.env.VERCEL
      ? url.searchParams.get("__relayguard_path")
      : null;
    if (relayguardPath) {
      if (!/^\/(?:api|pay)\//.test(relayguardPath)) {
        response(res, 400, { error: "Invalid routed request path." });
        return;
      }
      url.pathname = relayguardPath;
      url.searchParams.delete("__relayguard_path");
    }
    const paymentPath =
      process.env.VERCEL && url.pathname.startsWith("/api/pay/")
        ? url.pathname.slice("/api".length)
        : url.pathname;
    if (url.pathname.startsWith("/api/") && paymentPath === url.pathname) {
      await handleApi(req, res, url);
      return;
    }
    if (paymentPath.startsWith("/pay/") && req.method === "GET") {
      const content = await readFile(resolve(publicDirectory, "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'self'; connect-src 'self' https://*.supabase.co https://facilitator.vativ.io; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(content);
      return;
    }
    const files: Record<string, { name: string; type: string }> = {
      "/": { name: "index.html", type: "text/html; charset=utf-8" },
      "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" },
      "/x402-client.js": { name: "x402-client.js", type: "text/javascript; charset=utf-8" },
      "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
      "/relayguard-mark.svg": { name: "relayguard-mark.svg", type: "image/svg+xml" }
    };
    const file = files[url.pathname];
    if (!file || req.method !== "GET") {
      response(res, 404, { error: "Not found." });
      return;
    }
    const content = await readFile(resolve(publicDirectory, file.name));
    res.writeHead(200, {
      "content-type": file.type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; connect-src 'self' https://*.supabase.co https://facilitator.vativ.io; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message.toLowerCase().includes("not found")
      ? 404
      : message.includes("JSON") || message.includes("required") || message.includes("invalid") || message.includes("greater") || message.includes("Supported") || message.includes("Request body")
        ? 400
        : 500;
    console.error("RelayGuard request failed:", message);
    if (!res.headersSent) {
      response(res, status, { error: message });
    } else {
      res.destroy();
    }
  }
});

if (!process.env.VERCEL) {
  const server = app.listen(port, host, () => {
    console.log(`RelayGuard Mezo demo listening at http://${host}:${port}`);
    console.log(`Network: ${mezoTestnet.name} (${mezoTestnet.id}); wallet: ${signerAddress}`);
    console.log(`Supabase auth: ${supabase ? "configured" : "not configured"}`);
    console.log(`x402 MUSD resource: ${x402Enabled ? "enabled" : "disabled"}`);
    if (!allowedRecipients.length) {
      console.warn("No recipients are policy-approved. Set MEZO_ALLOWED_RECIPIENTS before submitting a payment.");
    }
  });
  const shutdown = (): void => {
    server.close(() => {
      void Promise.all([authorization.close(), checkout.close()]).finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export default app;
