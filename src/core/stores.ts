import type { CheckoutInvoice } from "./checkout.js";
import type {
  AuditEvent,
  RequestResult
} from "./authorization.js";
import type {
  AuthorizationRecord,
  PaymentIntent,
  SpendingPolicy
} from "./domain.js";

export type Awaitable<T> = T | Promise<T>;

export interface AuthorizationStore {
  request(intent: PaymentIntent, policy: SpendingPolicy, now?: number): Awaitable<RequestResult>;
  approve(
    recordId: string,
    approverId: string,
    challenge: string,
    currentPolicy: SpendingPolicy,
    now?: number
  ): Awaitable<AuthorizationRecord>;
  reject(
    recordId: string,
    approverId: string,
    currentPolicy: SpendingPolicy,
    now?: number
  ): Awaitable<AuthorizationRecord>;
  markExecuting(recordId: string, now?: number): Awaitable<AuthorizationRecord>;
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
