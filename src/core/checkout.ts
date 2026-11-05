import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CheckoutStore,
  MerchantProfile,
  MerchantWalletChallenge,
  MerchantX402Resource
} from "./stores.js";

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

export class CheckoutService implements CheckoutStore {
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
      CREATE TABLE IF NOT EXISTS merchant_profiles (
        user_id TEXT PRIMARY KEY,
        merchant_name TEXT NOT NULL,
        merchant_address TEXT,
        wallet_verified INTEGER NOT NULL DEFAULT 0 CHECK (wallet_verified IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS request_limits (
        key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits (window_start);
      CREATE TABLE IF NOT EXISTS merchant_wallet_challenges (
        id TEXT PRIMARY KEY,
        merchant_user_id TEXT NOT NULL,
        address TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS merchant_x402_resources (
        id TEXT PRIMARY KEY,
        merchant_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
        route_path TEXT NOT NULL,
        price TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (merchant_user_id, method, route_path)
      );
      CREATE TABLE IF NOT EXISTS merchant_x402_api_keys (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL UNIQUE REFERENCES merchant_x402_resources(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
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
      CREATE UNIQUE INDEX IF NOT EXISTS checkout_invoices_transaction_identity
        ON checkout_invoices (lower(transaction_reference)) WHERE transaction_reference IS NOT NULL;
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

  consumeRequestLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
    this.ensureOpen();
    const start = Math.floor(now / windowMs) * windowMs;
    this.database.prepare("DELETE FROM request_limits WHERE window_start < ?").run(start - windowMs);
    const row = this.database.prepare(`INSERT INTO request_limits (key, window_start, request_count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        request_count = CASE WHEN request_limits.window_start = excluded.window_start THEN request_limits.request_count + 1 ELSE 1 END,
        window_start = excluded.window_start RETURNING request_count`).get(key, start) as { request_count: number };
    return { allowed: row.request_count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }

  getMerchantProfile(merchantUserId: string): MerchantProfile | undefined {
    this.ensureOpen();
    const row = this.database.prepare("SELECT * FROM merchant_profiles WHERE user_id = ?").get(merchantUserId);
    if (!row) return undefined;
    const profile = row as Record<string, unknown>;
    return Object.freeze({
      userId: String(profile.user_id),
      merchantName: String(profile.merchant_name),
      ...(typeof profile.merchant_address === "string" ? { merchantAddress: profile.merchant_address } : {}),
      walletVerified: Number(profile.wallet_verified) === 1
    });
  }

  updateMerchantName(merchantUserId: string, merchantName: string): boolean {
    this.ensureOpen();
    if (!merchantName.trim() || merchantName.trim().length > 120) {
      throw new Error("Merchant name must be between 1 and 120 characters.");
    }
    const result = this.database.prepare(
      `UPDATE merchant_profiles SET merchant_name = ?
       WHERE user_id = ? AND wallet_verified = 1`
    ).run(merchantName.trim(), merchantUserId);
    return Number(result.changes) === 1;
  }

  createWalletChallenge(input: {
    readonly id: string;
    readonly merchantUserId: string;
    readonly address: string;
    readonly message: string;
    readonly expiresAt: number;
  }): void {
    this.ensureOpen();
    this.database.prepare("DELETE FROM merchant_wallet_challenges WHERE expires_at <= ?").run(Date.now());
    this.database.prepare(
      `INSERT INTO merchant_wallet_challenges (id, merchant_user_id, address, message, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.id, input.merchantUserId, input.address, input.message, input.expiresAt);
  }

  consumeWalletChallenge(
    merchantUserId: string,
    challengeId: string,
    now = Date.now()
  ): MerchantWalletChallenge | undefined {
    this.ensureOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(
        `SELECT * FROM merchant_wallet_challenges
         WHERE id = ? AND merchant_user_id = ? AND expires_at > ?`
      ).get(challengeId, merchantUserId, now) as Record<string, unknown> | undefined;
      if (!row) {
        this.database.exec("COMMIT");
        return undefined;
      }
      this.database.prepare("DELETE FROM merchant_wallet_challenges WHERE id = ?").run(challengeId);
      this.database.exec("COMMIT");
      return Object.freeze({
        id: String(row.id),
        merchantUserId: String(row.merchant_user_id),
        address: String(row.address),
        message: String(row.message),
        expiresAt: Number(row.expires_at)
      });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveVerifiedWallet(merchantUserId: string, merchantName: string, address: string): void {
    this.ensureOpen();
    this.database.prepare(
      `INSERT INTO merchant_profiles (user_id, merchant_name, merchant_address, wallet_verified)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET merchant_address = excluded.merchant_address, wallet_verified = 1`
    ).run(merchantUserId, merchantName.trim(), address);
  }

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
  }): MerchantX402Resource {
    this.ensureOpen();
    const profile = this.getMerchantProfile(input.merchantUserId);
    if (!profile?.walletVerified || !profile.merchantAddress) {
      throw new Error("Verify a merchant receiving wallet before configuring x402 resources.");
    }
    if (
      !input.name.trim() || !input.description.trim() ||
      !/^\/[A-Za-z0-9/_-]*$/.test(input.routePath) || input.routePath.includes("//") ||
      !/^\$\d+(?:\.\d{1,18})?$/.test(input.price) ||
      !/^[0-9a-f]{64}$/.test(input.keyHash) || !input.keyPrefix.trim()
    ) {
      throw new Error("Invalid x402 resource details.");
    }
    const resource = Object.freeze({
      id: randomUUID(),
      merchantUserId: input.merchantUserId,
      name: input.name.trim().slice(0, 80),
      method: input.method,
      routePath: input.routePath,
      price: input.price,
      description: input.description.trim().slice(0, 240),
      createdAt: input.now ?? Date.now(),
      keyPrefix: input.keyPrefix,
      payTo: profile.merchantAddress
    });
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        `INSERT INTO merchant_x402_resources
         (id, merchant_user_id, name, method, route_path, price, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(resource.id, resource.merchantUserId, resource.name, resource.method, resource.routePath,
        resource.price, resource.description, resource.createdAt);
      this.database.prepare(
        `INSERT INTO merchant_x402_api_keys (id, resource_id, key_hash, key_prefix, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), resource.id, input.keyHash, input.keyPrefix, resource.createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return resource;
  }

  listX402Resources(merchantUserId: string): readonly MerchantX402Resource[] {
    this.ensureOpen();
    return this.database.prepare(
      `SELECT resource.*, api.key_prefix, api.created_at AS key_created_at,
              api.last_used_at AS key_last_used_at, api.revoked_at AS key_revoked_at
       FROM merchant_x402_resources resource
       LEFT JOIN merchant_x402_api_keys api ON api.resource_id = resource.id
       WHERE resource.merchant_user_id = ? ORDER BY resource.created_at DESC`
    ).all(merchantUserId).map((value) => this.decodeX402Resource(value as Record<string, unknown>));
  }

  rotateX402ApiKey(
    merchantUserId: string,
    resourceId: string,
    keyHash: string,
    keyPrefix: string,
    now = Date.now()
  ): boolean {
    this.ensureOpen();
    if (!/^[0-9a-f]{64}$/.test(keyHash)) throw new Error("Invalid API key hash.");
    const id = randomUUID();
    const result = this.database.prepare(
      `INSERT INTO merchant_x402_api_keys (id, resource_id, key_hash, key_prefix, created_at)
       SELECT ?, id, ?, ?, ? FROM merchant_x402_resources
       WHERE id = ? AND merchant_user_id = ?
       ON CONFLICT(resource_id) DO UPDATE SET
         id = excluded.id, key_hash = excluded.key_hash, key_prefix = excluded.key_prefix,
         created_at = excluded.created_at, last_used_at = NULL, revoked_at = NULL`
    ).run(id, keyHash, keyPrefix, now, resourceId, merchantUserId);
    return Number(result.changes) > 0;
  }

  getX402ResourceByApiKey(keyHash: string, now = Date.now()): MerchantX402Resource | undefined {
    this.ensureOpen();
    const row = this.database.prepare(
      `SELECT resource.*, profile.merchant_address AS pay_to
       FROM merchant_x402_api_keys api
       JOIN merchant_x402_resources resource ON resource.id = api.resource_id
       JOIN merchant_profiles profile ON profile.user_id = resource.merchant_user_id
       WHERE api.key_hash = ? AND api.revoked_at IS NULL AND profile.wallet_verified = 1`
    ).get(keyHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    this.database.prepare("UPDATE merchant_x402_api_keys SET last_used_at = ? WHERE key_hash = ?").run(now, keyHash);
    return this.decodeX402Resource(row);
  }

  revokeX402ApiKey(merchantUserId: string, resourceId: string, now = Date.now()): void {
    this.ensureOpen();
    this.database.prepare(
      `UPDATE merchant_x402_api_keys SET revoked_at = ?
       WHERE resource_id = ? AND resource_id IN (
         SELECT id FROM merchant_x402_resources WHERE merchant_user_id = ?
       ) AND revoked_at IS NULL`
    ).run(now, resourceId, merchantUserId);
  }

  deleteX402Resource(merchantUserId: string, resourceId: string): boolean {
    this.ensureOpen();
    const result = this.database.prepare(
      "DELETE FROM merchant_x402_resources WHERE id = ? AND merchant_user_id = ?"
    ).run(resourceId, merchantUserId);
    return Number(result.changes) === 1;
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
    this.database.prepare("UPDATE checkout_invoices SET status = 'expired' WHERE merchant_user_id = ? AND status = 'open' AND expires_at <= ?")
      .run(merchantUserId, Date.now());
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
      .run(reference.toLowerCase(), id, authorizationId);
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

  ready(): Promise<void> {
    return Promise.resolve();
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

  private decodeX402Resource(row: Record<string, unknown>): MerchantX402Resource {
    return Object.freeze({
      id: String(row.id),
      merchantUserId: String(row.merchant_user_id),
      name: String(row.name),
      method: String(row.method) as "GET" | "POST",
      routePath: String(row.route_path),
      price: String(row.price),
      description: String(row.description),
      createdAt: Number(row.created_at),
      ...(typeof row.key_prefix === "string" ? { keyPrefix: row.key_prefix } : {}),
      ...(typeof row.key_created_at === "number" ? { keyCreatedAt: row.key_created_at } : {}),
      ...(typeof row.key_last_used_at === "number" ? { keyLastUsedAt: row.key_last_used_at } : {}),
      ...(typeof row.key_revoked_at === "number" ? { keyRevokedAt: row.key_revoked_at } : {}),
      ...(typeof row.pay_to === "string" ? { payTo: row.pay_to } : {})
    });
  }
}
