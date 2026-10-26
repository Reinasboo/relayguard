import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { AuthorizationRecord, AuthorizationStatus, PaymentIntent, SpendingPolicy } from "./domain.js";
import { digest, evaluatePolicy, validatePolicy } from "./policy.js";
import type { AuditEvent, RequestResult } from "./authorization.js";
import type { CheckoutInvoice, CheckoutStatus } from "./checkout.js";
import type { AuthorizationStore, CheckoutStore } from "./stores.js";

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const TERMINAL_UNSPENT_STATES = ["denied", "failed", "cancelled", "expired"] as const;
const ZERO_HASH = "0".repeat(64);

function createPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  for (const option of ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "uselibpqcompat"]) {
    url.searchParams.delete(option);
  }
  const ca = process.env.SUPABASE_DB_CA_CERT;
  return new Pool({
    connectionString: url.toString(),
    max: 1,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }
  });
}

function approvalTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  return /^[0-9a-f]{64}$/.test(left) &&
    /^[0-9a-f]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validTransition(from: AuthorizationStatus, to: AuthorizationStatus): boolean {
  const transitions: Record<AuthorizationStatus, readonly AuthorizationStatus[]> = {
    denied: [],
    awaiting_approval: ["authorized", "denied", "expired", "cancelled"],
    authorized: ["executing", "submitted", "failed", "cancelled"],
    executing: ["submitted", "failed"],
    submitted: ["confirmed", "failed"],
    confirmed: [],
    failed: [],
    cancelled: [],
    expired: []
  };
  return transitions[from].includes(to);
}

function isAuthorizationStatus(value: unknown): value is AuthorizationStatus {
  return typeof value === "string" &&
    ["denied", "awaiting_approval", "authorized", "executing", "submitted", "confirmed", "failed", "cancelled", "expired"].includes(value);
}

function decodeRecord(value: unknown): AuthorizationRecord {
  const record = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (
    record === null ||
    typeof record !== "object" ||
    !("id" in record) ||
    typeof record.id !== "string" ||
    !("intent" in record) ||
    record.intent === null ||
    typeof record.intent !== "object" ||
    !("status" in record) ||
    !isAuthorizationStatus(record.status) ||
    !("intentDigest" in record) ||
    typeof record.intentDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.intentDigest)
  ) {
    throw new Error("Authorization database contains a malformed record.");
  }
  const typed = record as AuthorizationRecord;
  return Object.freeze({ ...typed, intent: Object.freeze({ ...typed.intent }) });
}

function decodeAuditEvent(row: QueryResultRow): AuditEvent {
  const event: AuditEvent = {
    sequence: Number(row.sequence),
    at: Number(row.at),
    type: String(row.type),
    recordId: String(row.record_id),
    intentDigest: String(row.intent_digest),
    status: String(row.status) as AuthorizationStatus,
    previousHash: String(row.previous_hash),
    hash: String(row.hash)
  };
  if (
    !Number.isSafeInteger(event.sequence) ||
    !Number.isFinite(event.at) ||
    !isAuthorizationStatus(event.status) ||
    !/^[0-9a-f]{64}$/.test(event.intentDigest) ||
    !/^[0-9a-f]{64}$/.test(event.previousHash) ||
    !/^[0-9a-f]{64}$/.test(event.hash)
  ) {
    throw new Error("Authorization database contains a malformed audit event.");
  }
  return Object.freeze(event);
}

function decodeInvoice(row: QueryResultRow): CheckoutInvoice {
  const status = String(row.status);
  const amountAtomic = String(row.amount_atomic);
  if (
    !["open", "authorized", "submitted", "paid", "expired", "failed"].includes(status) ||
    !/^[1-9][0-9]*$/.test(amountAtomic)
  ) {
    throw new Error("Checkout database contains malformed invoice data.");
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

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAuthorizationService implements AuthorizationStore {
  private readonly pool: Pool;
  private readyPromise: Promise<void>;

  constructor(connectionString: string) {
    this.pool = createPool(connectionString);
    this.readyPromise = this.verifyAuditChain().then((valid) => {
      if (!valid) {
        throw new Error("Authorization audit chain is invalid; refusing to use the database.");
      }
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async request(intent: PaymentIntent, policy: SpendingPolicy, now = Date.now()): Promise<RequestResult> {
    if (!Number.isFinite(now)) throw new Error("Authorization timestamp must be a finite number.");
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [intent.agentId]);
      const priorResult = await client.query(
        "SELECT record_json FROM public.relayguard_authorizations WHERE agent_id = $1 AND idempotency_key = $2",
        [intent.agentId, intent.idempotencyKey]
      );
      if (priorResult.rowCount) {
        const prior = decodeRecord(priorResult.rows[0].record_json);
        if (!safeEqualHex(prior.intentDigest, digest(intent))) {
          throw new Error("Idempotency key was already used for a different transaction intent.");
        }
        return { record: prior, replayed: true };
      }

      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const spendRows = await client.query(
        `SELECT amount_atomic FROM public.relayguard_authorizations
         WHERE agent_id = $1 AND network = $2 AND asset = $3
           AND created_at >= $4 AND created_at <= $5
           AND status <> ALL($6::text[])`,
        [intent.agentId, intent.network, intent.asset, dayStart.getTime(), now, [...TERMINAL_UNSPENT_STATES]]
      );
      const spentTodayAtomic = spendRows.rows.reduce((total: bigint, row: QueryResultRow) => {
        const value = String(row.amount_atomic);
        if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Authorization database contains an invalid reserved amount.");
        return total + BigInt(value);
      }, 0n);
      const decision = evaluatePolicy(intent, policy, { now, spentTodayAtomic });
      const policyDigest = digest(policy);
      let status: AuthorizationStatus = "denied";
      let reason: string | undefined;
      let challengeHash: string | null = null;
      let approvalChallenge: string | undefined;
      let approvalExpiresAt: number | undefined;
      if (decision.outcome === "deny") {
        reason = decision.reason;
      } else if (decision.requiresApproval) {
        status = "awaiting_approval";
        approvalExpiresAt = now + APPROVAL_TTL_MS;
        approvalChallenge = randomBytes(32).toString("base64url");
        challengeHash = approvalTokenHash(approvalChallenge);
      } else {
        status = "authorized";
      }
      const record: AuthorizationRecord = Object.freeze({
        id: randomUUID(),
        intent: Object.freeze({ ...intent }),
        intentDigest: digest(intent),
        policyId: policy.id,
        policyVersion: policy.version,
        policyDigest,
        status,
        createdAt: now,
        updatedAt: now,
        ...(reason === undefined ? {} : { reason }),
        ...(approvalExpiresAt === undefined ? {} : { approvalExpiresAt })
      });
      await client.query(
        `INSERT INTO public.relayguard_authorizations
         (id, agent_id, idempotency_key, network, asset, amount_atomic, created_at, status, record_json, challenge_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [record.id, intent.agentId, intent.idempotencyKey, intent.network, intent.asset, intent.amountAtomic,
          now, status, JSON.stringify(record), challengeHash]
      );
      await this.appendAudit(client, "authorization_decided", record, now);
      return {
        record,
        ...(approvalChallenge === undefined ? {} : { approvalChallenge }),
        replayed: false
      };
    });
  }

  async approve(recordId: string, approverId: string, challenge: string, currentPolicy: SpendingPolicy, now = Date.now()): Promise<AuthorizationRecord> {
    if (!Number.isFinite(now)) throw new Error("Authorization timestamp must be a finite number.");
    const result = await inTransaction(this.pool, async (client) => {
      const record = await this.requireRecord(recordId, client, true);
      if (await this.expireIfNecessary(record, now, client)) return { expired: true as const };
      if (record.status !== "awaiting_approval") throw new Error(`Approval is not available in state '${record.status}'.`);
      if (!validatePolicy(currentPolicy) || digest(currentPolicy) !== record.policyDigest) {
        throw new Error("Approval is invalid because the bound policy has changed.");
      }
      if (!currentPolicy.approverIds.includes(approverId)) throw new Error("Approver is not authorized by the bound policy.");
      const row = await client.query("SELECT challenge_hash FROM public.relayguard_authorizations WHERE id = $1", [recordId]);
      const expectedHash = row.rows[0]?.challenge_hash;
      if (typeof expectedHash !== "string" || !safeEqualHex(expectedHash, approvalTokenHash(challenge))) {
        throw new Error("Approval challenge is invalid.");
      }
      return { record: await this.transition(record, "authorized", now, client) };
    });
    if ("expired" in result) throw new Error("Approval challenge has expired.");
    return result.record;
  }

  async reject(recordId: string, approverId: string, currentPolicy: SpendingPolicy, now = Date.now()): Promise<AuthorizationRecord> {
    if (!Number.isFinite(now)) throw new Error("Authorization timestamp must be a finite number.");
    const result = await inTransaction(this.pool, async (client) => {
      const record = await this.requireRecord(recordId, client, true);
      if (await this.expireIfNecessary(record, now, client)) return { expired: true as const };
      if (record.status !== "awaiting_approval") throw new Error(`Approval is not available in state '${record.status}'.`);
      if (!validatePolicy(currentPolicy) || digest(currentPolicy) !== record.policyDigest || !currentPolicy.approverIds.includes(approverId)) {
        throw new Error("Approver or policy is not valid for this approval.");
      }
      return { record: await this.transition(record, "denied", now, client, "human_rejected") };
    });
    if ("expired" in result) throw new Error("Approval challenge has expired.");
    return result.record;
  }

  markExecuting(recordId: string, now = Date.now()): Promise<AuthorizationRecord> {
    return this.transitionById(recordId, "executing", now);
  }

  markSubmitted(recordId: string, now = Date.now(), reference?: string): Promise<AuthorizationRecord> {
    if (reference !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(reference)) {
      throw new Error("Submitted transaction reference must be a 32-byte hex hash.");
    }
    return this.transitionById(recordId, "submitted", now, undefined, reference);
  }

  markConfirmed(recordId: string, now = Date.now()): Promise<AuthorizationRecord> {
    return this.transitionById(recordId, "confirmed", now);
  }

  markFailed(recordId: string, reason: string, now = Date.now()): Promise<AuthorizationRecord> {
    if (!reason.trim()) throw new Error("A failure reason is required.");
    return this.transitionById(recordId, "failed", now, reason);
  }

  async cancel(recordId: string, now = Date.now()): Promise<AuthorizationRecord> {
    if (!Number.isFinite(now)) throw new Error("Authorization timestamp must be a finite number.");
    return inTransaction(this.pool, async (client) => {
      const record = await this.requireRecord(recordId, client, true);
      if (record.status !== "awaiting_approval" && record.status !== "authorized") {
        throw new Error(`Cannot cancel an authorization in state '${record.status}'.`);
      }
      return this.transition(record, "cancelled", now, client);
    });
  }

  async get(recordId: string): Promise<AuthorizationRecord> {
    return this.requireRecord(recordId);
  }

  async auditEvents(): Promise<readonly AuditEvent[]> {
    const result = await this.pool.query("SELECT * FROM public.relayguard_audit_events ORDER BY sequence");
    return result.rows.map(decodeAuditEvent);
  }

  async verifyAuditChain(): Promise<boolean> {
    let previousHash = ZERO_HASH;
    const events = await this.auditEvents();
    for (const event of events) {
      const { hash, ...unsigned } = event;
      if (event.previousHash !== previousHash || digest(unsigned) !== hash) return false;
      previousHash = event.hash;
    }
    const head = await this.pool.query("SELECT sequence, hash FROM public.relayguard_audit_head WHERE id = true");
    if (head.rowCount !== 1) return false;
    return Number(head.rows[0].sequence) === events.length && String(head.rows[0].hash) === previousHash;
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async transitionById(recordId: string, nextStatus: AuthorizationStatus, now: number, reason?: string, reference?: string): Promise<AuthorizationRecord> {
    if (!Number.isFinite(now)) throw new Error("Authorization timestamp must be a finite number.");
    return inTransaction(this.pool, async (client) => {
      const record = await this.requireRecord(recordId, client, true);
      return this.transition(record, nextStatus, now, client, reason, reference);
    });
  }

  private async transition(
    previous: AuthorizationRecord,
    nextStatus: AuthorizationStatus,
    now: number,
    client: PoolClient,
    reason?: string,
    reference?: string
  ): Promise<AuthorizationRecord> {
    if (!validTransition(previous.status, nextStatus)) {
      throw new Error(`Invalid authorization transition '${previous.status}' -> '${nextStatus}'.`);
    }
    const next: AuthorizationRecord = Object.freeze({
      ...previous,
      status: nextStatus,
      updatedAt: now,
      ...(reason === undefined ? {} : { reason }),
      ...(reference === undefined ? {} : { transactionReference: reference })
    });
    const result = await client.query(
      `UPDATE public.relayguard_authorizations SET status = $1, record_json = $2::jsonb, challenge_hash = NULL
       WHERE id = $3 AND status = $4`,
      [next.status, JSON.stringify(next), next.id, previous.status]
    );
    if (result.rowCount !== 1) throw new Error("Authorization state changed concurrently.");
    await this.appendAudit(client, `state_${nextStatus}`, next, now);
    return next;
  }

  private async expireIfNecessary(record: AuthorizationRecord, now: number, client: PoolClient): Promise<boolean> {
    if (record.status !== "awaiting_approval") return false;
    if (record.approvalExpiresAt === undefined || now >= record.approvalExpiresAt) {
      await this.transition(record, "expired", now, client);
      return true;
    }
    return false;
  }

  private async requireRecord(id: string, client?: PoolClient, lock = false): Promise<AuthorizationRecord> {
    const db = client ?? this.pool;
    const result = await db.query(
      `SELECT record_json FROM public.relayguard_authorizations WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [id]
    );
    if (!result.rowCount) throw new Error(`Authorization '${id}' was not found.`);
    return decodeRecord(result.rows[0].record_json);
  }

  private async appendAudit(client: PoolClient, type: string, record: AuthorizationRecord, at: number): Promise<void> {
    const head = await client.query("SELECT sequence, hash FROM public.relayguard_audit_head WHERE id = true FOR UPDATE");
    if (!head.rowCount) throw new Error("Authorization audit head is missing.");
    const sequence = Number(head.rows[0].sequence) + 1;
    const previousHash = String(head.rows[0].hash);
    const unsigned = {
      sequence,
      at,
      type,
      recordId: record.id,
      intentDigest: record.intentDigest,
      status: record.status,
      previousHash
    };
    const hash = digest(unsigned);
    await client.query(
      `INSERT INTO public.relayguard_audit_events
       (sequence, at, type, record_id, intent_digest, status, previous_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sequence, at, type, record.id, record.intentDigest, record.status, previousHash, hash]
    );
    await client.query("UPDATE public.relayguard_audit_head SET sequence = $1, hash = $2 WHERE id = true", [sequence, hash]);
  }
}

export class PostgresCheckoutService implements CheckoutStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = createPool(connectionString);
  }

  async ready(): Promise<void> {
    await this.pool.query("SELECT 1 FROM public.merchant_invoices LIMIT 1");
  }

  async create(input: {
    readonly merchantUserId: string;
    readonly merchantName: string;
    readonly merchantAddress: string;
    readonly amountAtomic: string;
    readonly description: string;
    readonly expiresAt: number;
    readonly now?: number;
  }): Promise<CheckoutInvoice> {
    const now = input.now ?? Date.now();
    if (
      !input.merchantName.trim() || !input.merchantUserId.trim() || !input.merchantAddress.trim() ||
      !/^[1-9][0-9]*$/.test(input.amountAtomic) || !input.description.trim() ||
      !Number.isFinite(input.expiresAt) || input.expiresAt <= now
    ) {
      throw new Error("Invalid merchant checkout invoice details.");
    }
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO public.merchant_invoices
       (id, merchant_user_id, merchant_name, merchant_address, asset, amount_atomic, description, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'MUSD', $5, $6, 'open', $7, $8) RETURNING *`,
      [id, input.merchantUserId, input.merchantName.trim(), input.merchantAddress, input.amountAtomic,
        input.description.trim(), now, input.expiresAt]
    );
    return decodeInvoice(result.rows[0]);
  }

  async get(id: string, now = Date.now()): Promise<CheckoutInvoice> {
    const result = await this.pool.query(
      `UPDATE public.merchant_invoices SET status = 'expired'
       WHERE id = $1 AND status = 'open' AND expires_at <= $2`,
      [id, now]
    );
    void result;
    const row = await this.pool.query("SELECT * FROM public.merchant_invoices WHERE id = $1", [id]);
    if (!row.rowCount) throw new Error("Checkout invoice was not found.");
    return decodeInvoice(row.rows[0]);
  }

  async list(merchantUserId: string, limit = 50): Promise<readonly CheckoutInvoice[]> {
    const result = await this.pool.query(
      "SELECT * FROM public.merchant_invoices WHERE merchant_user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [merchantUserId, Math.max(1, Math.min(100, limit))]
    );
    return result.rows.map(decodeInvoice);
  }

  async authorize(id: string, authorizationId: string, now = Date.now()): Promise<CheckoutInvoice> {
    await this.get(id, now);
    const result = await this.pool.query(
      `UPDATE public.merchant_invoices SET status = 'authorized', authorization_id = $2
       WHERE id = $1 AND status = 'open' RETURNING *`,
      [id, authorizationId]
    );
    if (!result.rowCount) throw new Error("Checkout invoice was reserved by another payment attempt.");
    return decodeInvoice(result.rows[0]);
  }

  async submit(id: string, authorizationId: string, reference: string, now = Date.now()): Promise<CheckoutInvoice> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(reference)) throw new Error("Checkout transaction reference must be a 32-byte hex hash.");
    await this.get(id, now);
    const result = await this.pool.query(
      `UPDATE public.merchant_invoices
       SET status = 'submitted', transaction_reference = $3
       WHERE id = $1 AND status = 'authorized' AND authorization_id = $2 RETURNING *`,
      [id, authorizationId, reference]
    );
    if (!result.rowCount) throw new Error("Checkout invoice does not match an active authorization.");
    return decodeInvoice(result.rows[0]);
  }

  async release(id: string, authorizationId: string, now = Date.now()): Promise<CheckoutInvoice> {
    await this.get(id, now);
    const result = await this.pool.query(
      `UPDATE public.merchant_invoices
       SET status = 'open', authorization_id = NULL
       WHERE id = $1 AND status = 'authorized' AND authorization_id = $2 RETURNING *`,
      [id, authorizationId]
    );
    if (!result.rowCount) throw new Error("Only the matching unsubmitted authorization can release an invoice.");
    return decodeInvoice(result.rows[0]);
  }

  async settle(id: string, status: "paid" | "failed"): Promise<CheckoutInvoice> {
    const result = await this.pool.query(
      `UPDATE public.merchant_invoices SET status = $2
       WHERE id = $1 AND status = 'submitted' RETURNING *`,
      [id, status]
    );
    if (!result.rowCount) throw new Error("Checkout invoice cannot settle from its current state.");
    return decodeInvoice(result.rows[0]);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
