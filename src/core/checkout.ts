import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type CheckoutStatus = "open" | "authorized" | "submitted" | "paid" | "expired" | "failed";

export interface CheckoutInvoice {
  readonly id: string;
  readonly merchantUserId: string;
  readonly merchantName: string;
  readonly merchantAddress: string;
  readonly asset: "MUSD";
  readonly amountAtomic: string;
  readonly description: string;
  readonly status: CheckoutStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly authorizationId?: string;
  readonly transactionReference?: string;
}

function decodeInvoice(row: Record<string, unknown>): CheckoutInvoice {
  const status = String(row.status);
  if (!["open", "authorized", "submitted", "paid", "expired", "failed"].includes(status)) {
    throw new Error("Checkout database contains an invalid invoice status.");
  }
  const amountAtomic = String(row.amount_atomic);
  if (!/^[1-9][0-9]*$/.test(amountAtomic)) {
    throw new Error("Checkout database contains an invalid invoice amount.");
  }
  return Object.freeze({
    id: String(row.id),
    merchantUserId: String(row.merchant_user_id),
    merchantName: String(row.merchant_name),
    merchantAddress: String(row.merchant_address),
    asset: "MUSD",
    amountAtomic,
    description: String(row.description),
    status: status as CheckoutStatus,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ...(typeof row.authorization_id === "string" ? { authorizationId: row.authorization_id } : {}),
    ...(typeof row.transaction_reference === "string" ? { transactionReference: row.transaction_reference } : {})
  });
}

export class CheckoutService {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    if (databasePath !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL;");
      this.database.exec("PRAGMA synchronous = FULL;");
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS checkout_invoices (
        id TEXT PRIMARY KEY,
        merchant_user_id TEXT NOT NULL DEFAULT 'local-demo',
        merchant_name TEXT NOT NULL,
        merchant_address TEXT NOT NULL,
        asset TEXT NOT NULL CHECK (asset = 'MUSD'),
        amount_atomic TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        authorization_id TEXT UNIQUE,
        transaction_reference TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS checkout_invoices_recent
        ON checkout_invoices (created_at DESC);
    `);
    const columns = this.database
      .prepare("PRAGMA table_info(checkout_invoices)")
      .all() as Array<{ readonly name: string }>;
    if (!columns.some((column) => column.name === "merchant_user_id")) {
      this.database.exec(
        "ALTER TABLE checkout_invoices ADD COLUMN merchant_user_id TEXT NOT NULL DEFAULT 'local-demo'"
      );
    }
  }

  create(input: {
    readonly merchantUserId: string;
    readonly merchantName: string;
    readonly merchantAddress: string;
    readonly amountAtomic: string;
    readonly description: string;
    readonly expiresAt: number;
    readonly now?: number;
  }): CheckoutInvoice {
    this.ensureOpen();
    const now = input.now ?? Date.now();
    if (
      !input.merchantName.trim() ||
      !input.merchantUserId.trim() ||
      !input.merchantAddress.trim() ||
      !/^[1-9][0-9]*$/.test(input.amountAtomic) ||
      !input.description.trim() ||
      !Number.isFinite(input.expiresAt) ||
      input.expiresAt <= now
    ) {
      throw new Error("Invalid merchant checkout invoice details.");
    }
    const invoice = this.freeze({
      id: randomUUID(),
      merchantUserId: input.merchantUserId,
      merchantName: input.merchantName.trim(),
      merchantAddress: input.merchantAddress,
      asset: "MUSD",
      amountAtomic: input.amountAtomic,
      description: input.description.trim(),
      status: "open",
      createdAt: now,
      expiresAt: input.expiresAt
    });
    this.database
      .prepare(
        `INSERT INTO checkout_invoices (
          id, merchant_user_id, merchant_name, merchant_address, asset, amount_atomic, description,
          status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        invoice.id,
        invoice.merchantUserId,
        invoice.merchantName,
        invoice.merchantAddress,
        invoice.asset,
        invoice.amountAtomic,
        invoice.description,
        invoice.status,
        invoice.createdAt,
        invoice.expiresAt
      );
    return invoice;
  }

  get(id: string, now = Date.now()): CheckoutInvoice {
    this.ensureOpen();
    const row = this.database.prepare("SELECT * FROM checkout_invoices WHERE id = ?").get(id);
    if (!row) {
      throw new Error("Checkout invoice was not found.");
    }
    const invoice = decodeInvoice(row);
    if (invoice.status === "open" && now >= invoice.expiresAt) {
      this.database
        .prepare("UPDATE checkout_invoices SET status = 'expired' WHERE id = ? AND status = 'open'")
        .run(id);
      return this.get(id, now);
    }
    return invoice;
  }

  list(merchantUserId: string, limit = 50): readonly CheckoutInvoice[] {
    this.ensureOpen();
    const rows = this.database
      .prepare("SELECT * FROM checkout_invoices WHERE merchant_user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(merchantUserId, Math.max(1, Math.min(100, limit)));
    return rows.map(decodeInvoice);
  }

  authorize(id: string, authorizationId: string, now = Date.now()): CheckoutInvoice {
    const current = this.get(id, now);
    if (current.status !== "open") {
      throw new Error(`Checkout invoice cannot be authorized from state '${current.status}'.`);
    }
    const update = this.database
      .prepare(
        `UPDATE checkout_invoices SET status = 'authorized', authorization_id = ?
         WHERE id = ? AND status = 'open'`
      )
      .run(authorizationId, id);
    if (Number(update.changes) !== 1) {
      throw new Error("Checkout invoice was reserved by another payment attempt.");
    }
    return this.get(id, now);
  }

  submit(id: string, authorizationId: string, reference: string, now = Date.now()): CheckoutInvoice {
    const current = this.get(id, now);
    if (current.status !== "authorized" || current.authorizationId !== authorizationId) {
      throw new Error("Checkout invoice does not match an active authorization.");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(reference)) {
      throw new Error("Checkout transaction reference must be a 32-byte hex hash.");
    }
    const update = this.database
      .prepare(
        `UPDATE checkout_invoices
         SET status = 'submitted', transaction_reference = ?
         WHERE id = ? AND status = 'authorized' AND authorization_id = ?`
      )
      .run(reference, id, authorizationId);
    if (Number(update.changes) !== 1) {
      throw new Error("Checkout invoice was already submitted.");
    }
    return this.get(id, now);
  }

  release(id: string, authorizationId: string, now = Date.now()): CheckoutInvoice {
    const current = this.get(id, now);
    if (current.status !== "authorized" || current.authorizationId !== authorizationId) {
      throw new Error("Only the matching unsubmitted authorization can release an invoice.");
    }
    const update = this.database
      .prepare(
        `UPDATE checkout_invoices
         SET status = 'open', authorization_id = NULL
         WHERE id = ? AND status = 'authorized' AND authorization_id = ?`
      )
      .run(id, authorizationId);
    if (Number(update.changes) !== 1) {
      throw new Error("Checkout invoice could not be released.");
    }
    return this.get(id, now);
  }

  settle(id: string, status: "paid" | "failed"): CheckoutInvoice {
    const current = this.get(id);
    if (current.status !== "submitted") {
      throw new Error(`Checkout invoice cannot settle from state '${current.status}'.`);
    }
    this.database
      .prepare("UPDATE checkout_invoices SET status = ? WHERE id = ? AND status = 'submitted'")
      .run(status, id);
    return this.get(id);
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Checkout service is closed.");
    }
  }

  private freeze(invoice: CheckoutInvoice): CheckoutInvoice {
    return Object.freeze(invoice);
  }
}
