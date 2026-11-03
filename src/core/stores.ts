import type { CheckoutInvoice } from "./checkout.js";
import type {
  AuditEvent,
  RequestResult
} from "./authorization.js";
import type {
  AuthorizationRecord,
  MezoTroveEvidence,
  PaymentIntent,
  SpendingPolicy
} from "./domain.js";

export type Awaitable<T> = T | Promise<T>;

export interface AuthorizationStore {
  request(
    intent: PaymentIntent,
    policy: SpendingPolicy,
    now?: number,
    mezoTroveEvidence?: MezoTroveEvidence
  ): Awaitable<RequestResult>;
  approve(
    recordId: string,
    approverId: string,
    challenge: string,
    currentPolicy: SpendingPolicy,
    now?: number,
    mezoTroveEvidence?: MezoTroveEvidence
  ): Awaitable<AuthorizationRecord>;
  reject(
    recordId: string,
    approverId: string,
    currentPolicy: SpendingPolicy,
    now?: number
  ): Awaitable<AuthorizationRecord>;
  markExecuting(
    recordId: string,
    now?: number,
    mezoTroveEvidence?: MezoTroveEvidence
  ): Awaitable<AuthorizationRecord>;
  markSubmitted(recordId: string, now?: number, reference?: string): Awaitable<AuthorizationRecord>;
  markConfirmed(recordId: string, now?: number): Awaitable<AuthorizationRecord>;
  markFailed(recordId: string, reason: string, now?: number): Awaitable<AuthorizationRecord>;
  cancel(recordId: string, now?: number): Awaitable<AuthorizationRecord>;
  get(recordId: string): Awaitable<AuthorizationRecord>;
  auditEvents(): Awaitable<readonly AuditEvent[]>;
  verifyAuditChain(): Awaitable<boolean>;
  ready(): Promise<void>;
  close(): Awaitable<void>;
}

export interface CheckoutStore {
  getMerchantProfile(merchantUserId: string): Awaitable<MerchantProfile | undefined>;
  updateMerchantName(merchantUserId: string, merchantName: string): Awaitable<boolean>;
  createWalletChallenge(input: {
    readonly id: string;
    readonly merchantUserId: string;
    readonly address: string;
    readonly message: string;
    readonly expiresAt: number;
  }): Awaitable<void>;
  consumeWalletChallenge(
    merchantUserId: string,
    challengeId: string,
    now?: number
  ): Awaitable<MerchantWalletChallenge | undefined>;
  saveVerifiedWallet(merchantUserId: string, merchantName: string, address: string): Awaitable<void>;
  createX402Resource(input: {
    readonly merchantUserId: string;
    readonly name: string;
    readonly method: "GET" | "POST";
    readonly routePath: string;
    readonly price: string;
    readonly description: string;
    readonly keyHash: string;
    readonly keyPrefix: string;
    readonly now?: number;
  }): Awaitable<MerchantX402Resource>;
  listX402Resources(merchantUserId: string): Awaitable<readonly MerchantX402Resource[]>;
  rotateX402ApiKey(
    merchantUserId: string,
    resourceId: string,
    keyHash: string,
    keyPrefix: string,
    now?: number
  ): Awaitable<boolean>;
  getX402ResourceByApiKey(keyHash: string, now?: number): Awaitable<MerchantX402Resource | undefined>;
  revokeX402ApiKey(merchantUserId: string, resourceId: string, now?: number): Awaitable<void>;
  deleteX402Resource(merchantUserId: string, resourceId: string): Awaitable<boolean>;
  create(input: {
    readonly merchantUserId: string;
    readonly merchantName: string;
    readonly merchantAddress: string;
    readonly amountAtomic: string;
    readonly description: string;
    readonly expiresAt: number;
    readonly now?: number;
  }): Awaitable<CheckoutInvoice>;
  get(id: string, now?: number): Awaitable<CheckoutInvoice>;
  list(merchantUserId: string, limit?: number): Awaitable<readonly CheckoutInvoice[]>;
  authorize(id: string, authorizationId: string, now?: number): Awaitable<CheckoutInvoice>;
  submit(id: string, authorizationId: string, reference: string, now?: number): Awaitable<CheckoutInvoice>;
  release(id: string, authorizationId: string, now?: number): Awaitable<CheckoutInvoice>;
  settle(id: string, status: "paid" | "failed"): Awaitable<CheckoutInvoice>;
  ready(): Promise<void>;
  close(): Awaitable<void>;
}

export interface MerchantProfile {
  readonly userId: string;
  readonly merchantName: string;
  readonly merchantAddress?: string;
  readonly walletVerified: boolean;
}

export interface MerchantWalletChallenge {
  readonly id: string;
  readonly merchantUserId: string;
  readonly address: string;
  readonly message: string;
  readonly expiresAt: number;
}

export interface MerchantX402Resource {
  readonly id: string;
  readonly merchantUserId: string;
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly routePath: string;
  readonly price: string;
  readonly description: string;
  readonly createdAt: number;
  readonly keyPrefix?: string;
  readonly keyCreatedAt?: number;
  readonly keyLastUsedAt?: number;
  readonly keyRevokedAt?: number;
  readonly payTo?: string;
}
