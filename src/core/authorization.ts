import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AuthorizationRecord,
  AuthorizationStatus,
  PaymentIntent,
  SpendingPolicy
} from "./domain.js";
import { digest, evaluatePolicy, validatePolicy } from "./policy.js";
import type { AuthorizationStore } from "./stores.js";

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const TERMINAL_UNSPENT_STATES = ["denied", "failed", "cancelled", "expired"] as const;

export interface AuditEvent {
  readonly sequence: number;
  readonly at: number;
  readonly type: string;
  readonly recordId: string;
  readonly intentDigest: string;
  readonly status: AuthorizationStatus;
  readonly previousHash: string;
  readonly hash: string;
}

export type RequestResult =
  | {
      readonly record: AuthorizationRecord;
      readonly approvalChallenge?: string;
      readonly replayed: boolean;
    };

function approvalTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
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
  return (
    typeof value === "string" &&
    [
      "denied",
      "awaiting_approval",
      "authorized",
      "executing",
      "submitted",
      "confirmed",
      "failed",
      "cancelled",
      "expired"
    ].includes(value)
  );
}

function decodeRecord(serialized: string): AuthorizationRecord {
  const value: unknown = JSON.parse(serialized);
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("intent" in value) ||
    value.intent === null ||
    typeof value.intent !== "object" ||
    !("status" in value) ||
    !isAuthorizationStatus(value.status) ||
    !("intentDigest" in value) ||
    typeof value.intentDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.intentDigest)
  ) {
    throw new Error("Authorization database contains a malformed record.");
  }
  return value as AuthorizationRecord;
}

function decodeAuditEvent(row: Record<string, unknown>): AuditEvent {
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
    !/^[0-9a-f]{64}$/.test(event.intentDigest)
  ) {
    throw new Error("Authorization database contains a malformed audit event.");
  }
  return Object.freeze(event);
}

/**
 * SQLite-backed coordinator. Use a file path to persist across restarts.
 * The default in-memory path exists for isolated tests and local examples.
 * This class does not provide authentication or tenant isolation.
 */
export class AuthorizationService implements AuthorizationStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath = ":memory:") {
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
      CREATE TABLE IF NOT EXISTS authorizations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        network TEXT NOT NULL,
        asset TEXT NOT NULL,
        amount_atomic TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        challenge_hash TEXT,
        UNIQUE (agent_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS authorizations_daily_spend
        ON authorizations (agent_id, network, asset, created_at);
      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        record_id TEXT NOT NULL REFERENCES authorizations(id),
        intent_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
        VALUES (1, unixepoch() * 1000);
    `);
    this.ensureAuditChainValid();
  }

  request(
    intent: PaymentIntent,
    policy: SpendingPolicy,
    now = Date.now()
  ): RequestResult {
    this.ensureOpen();
    if (!Number.isFinite(now)) {
      throw new Error("Authorization timestamp must be a finite number.");
    }

    return this.transaction(() => {
      const intentDigest = digest(intent);
      const priorRow = this.database
        .prepare(
          "SELECT record_json FROM authorizations WHERE agent_id = ? AND idempotency_key = ?"
        )
        .get(intent.agentId, intent.idempotencyKey);
      if (priorRow !== undefined) {
        const prior = decodeRecord(String(priorRow.record_json));
        if (!safeEqualHex(prior.intentDigest, intentDigest)) {
          throw new Error("Idempotency key was already used for a different transaction intent.");
        }
        return { record: prior, replayed: true };
      }

      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const spendRows = this.database
        .prepare(
          `SELECT amount_atomic FROM authorizations
           WHERE agent_id = ? AND network = ? AND asset = ?
             AND created_at >= ? AND created_at <= ?
             AND status NOT IN (?, ?, ?, ?)`
        )
        .all(
          intent.agentId,
          intent.network,
          intent.asset,
          dayStart.getTime(),
          now,
          ...TERMINAL_UNSPENT_STATES
        );
      let spentTodayAtomic = 0n;
      for (const row of spendRows) {
        const amount = String(row.amount_atomic);
        if (!/^(0|[1-9][0-9]*)$/.test(amount)) {
          throw new Error("Authorization database contains an invalid reserved amount.");
        }
        spentTodayAtomic += BigInt(amount);
      }

      const decision = evaluatePolicy(intent, policy, { now, spentTodayAtomic });
      const id = randomUUID();
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

      const record = this.freezeRecord({
        id,
        intent,
        intentDigest,
        policyId: policy.id,
        policyVersion: policy.version,
        policyDigest,
        status,
        createdAt: now,
        updatedAt: now,
        ...(reason === undefined ? {} : { reason }),
        ...(approvalExpiresAt === undefined ? {} : { approvalExpiresAt })
      });
      this.insertRecord(record, challengeHash);
      this.appendAudit("authorization_decided", record, now);
      return {
        record,
        ...(approvalChallenge === undefined ? {} : { approvalChallenge }),
        replayed: false
      };
    });
  }

  approve(
    recordId: string,
    approverId: string,
    challenge: string,
    currentPolicy: SpendingPolicy,
    now = Date.now()
  ): AuthorizationRecord {
    this.ensureOpen();
    if (!Number.isFinite(now)) {
      throw new Error("Authorization timestamp must be a finite number.");
    }
    const result = this.transaction(() => {
      const record = this.requireRecord(recordId);
      if (this.expireIfNecessary(record, now)) {
        return { expired: true as const };
      }
      if (record.status !== "awaiting_approval") {
        throw new Error(`Approval is not available in state '${record.status}'.`);
      }
      if (!validatePolicy(currentPolicy) || digest(currentPolicy) !== record.policyDigest) {
        throw new Error("Approval is invalid because the bound policy has changed.");
      }
      if (!currentPolicy.approverIds.includes(approverId)) {
        throw new Error("Approver is not authorized by the bound policy.");
      }
      const row = this.database
        .prepare("SELECT challenge_hash FROM authorizations WHERE id = ?")
        .get(recordId);
      const expectedHash = row?.challenge_hash;
      if (
        typeof expectedHash !== "string" ||
        !safeEqualHex(expectedHash, approvalTokenHash(challenge))
      ) {
        throw new Error("Approval challenge is invalid.");
      }
      return { record: this.transition(record, "authorized", now) };
    });
    if ("expired" in result) {
      throw new Error("Approval challenge has expired.");
    }
    return result.record;
  }

  reject(
    recordId: string,
    approverId: string,
    currentPolicy: SpendingPolicy,
    now = Date.now()
  ): AuthorizationRecord {
    this.ensureOpen();
    if (!Number.isFinite(now)) {
      throw new Error("Authorization timestamp must be a finite number.");
    }
    const result = this.transaction(() => {
      const record = this.requireRecord(recordId);
      if (this.expireIfNecessary(record, now)) {
        return { expired: true as const };
      }
      if (record.status !== "awaiting_approval") {
        throw new Error(`Approval is not available in state '${record.status}'.`);
      }
      if (
        !validatePolicy(currentPolicy) ||
        digest(currentPolicy) !== record.policyDigest ||
        !currentPolicy.approverIds.includes(approverId)
      ) {
        throw new Error("Approver or policy is not valid for this approval.");
      }
      return { record: this.transition(record, "denied", now, "human_rejected") };
    });
    if ("expired" in result) {
      throw new Error("Approval challenge has expired.");
    }
    return result.record;
  }

  markExecuting(recordId: string, now = Date.now()): AuthorizationRecord {
    return this.transitionById(recordId, "executing", now);
  }

  markSubmitted(recordId: string, now = Date.now(), reference?: string): AuthorizationRecord {
    if (reference !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(reference)) {
      throw new Error("Submitted transaction reference must be a 32-byte hex hash.");
    }
    return this.transitionById(recordId, "submitted", now, undefined, reference);
  }

  markConfirmed(recordId: string, now = Date.now()): AuthorizationRecord {
    return this.transitionById(recordId, "confirmed", now);
  }

  markFailed(recordId: string, reason: string, now = Date.now()): AuthorizationRecord {
    if (!reason.trim()) {
      throw new Error("A failure reason is required.");
    }
    return this.transitionById(recordId, "failed", now, reason);
  }

  cancel(recordId: string, now = Date.now()): AuthorizationRecord {
    this.ensureOpen();
    if (!Number.isFinite(now)) {
      throw new Error("Authorization timestamp must be a finite number.");
    }
    return this.transaction(() => {
      const record = this.requireRecord(recordId);
      if (record.status !== "awaiting_approval" && record.status !== "authorized") {
        throw new Error(`Cannot cancel an authorization in state '${record.status}'.`);
      }
      return this.transition(record, "cancelled", now);
    });
  }

  get(recordId: string): AuthorizationRecord {
    this.ensureOpen();
    return this.requireRecord(recordId);
  }

  auditEvents(): readonly AuditEvent[] {
    this.ensureOpen();
    const rows = this.database
      .prepare("SELECT * FROM audit_events ORDER BY sequence")
      .all();
    return rows.map(decodeAuditEvent);
  }

  verifyAuditChain(): boolean {
    let previousHash = "0".repeat(64);
    for (const event of this.auditEvents()) {
      const { hash, ...unsigned } = event;
      if (event.previousHash !== previousHash || digest(unsigned) !== hash) {
        return false;
      }
      previousHash = event.hash;
    }
    return true;
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

  private transitionById(
    recordId: string,
    nextStatus: AuthorizationStatus,
    now: number,
    reason?: string,
    transactionReference?: string
  ): AuthorizationRecord {
    this.ensureOpen();
    if (!Number.isFinite(now)) {
      throw new Error("Authorization timestamp must be a finite number.");
    }
    return this.transaction(() =>
      this.transition(this.requireRecord(recordId), nextStatus, now, reason, transactionReference)
    );
  }

  private transition(
    previous: AuthorizationRecord,
    nextStatus: AuthorizationStatus,
    now: number,
    reason?: string,
    transactionReference?: string
  ): AuthorizationRecord {
    if (!validTransition(previous.status, nextStatus)) {
      throw new Error(`Invalid authorization transition '${previous.status}' -> '${nextStatus}'.`);
    }
    const next = this.freezeRecord({
      ...previous,
      status: nextStatus,
      updatedAt: now,
      ...(reason === undefined ? {} : { reason }),
      ...(transactionReference === undefined ? {} : { transactionReference })
    });
    this.database
      .prepare(
        `UPDATE authorizations
         SET status = ?, record_json = ?, challenge_hash = NULL
         WHERE id = ? AND status = ?`
      )
      .run(next.status, JSON.stringify(next), next.id, previous.status);
    this.appendAudit(`state_${nextStatus}`, next, now);
    return next;
  }

  private expireIfNecessary(record: AuthorizationRecord, now: number): boolean {
    if (record.status !== "awaiting_approval") {
      return false;
    }
    if (record.approvalExpiresAt === undefined || now >= record.approvalExpiresAt) {
      this.transition(record, "expired", now);
      return true;
    }
    return false;
  }

  private insertRecord(record: AuthorizationRecord, challengeHash: string | null): void {
    this.database
      .prepare(
        `INSERT INTO authorizations (
          id, agent_id, idempotency_key, network, asset, amount_atomic,
          created_at, status, record_json, challenge_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.intent.agentId,
        record.intent.idempotencyKey,
        record.intent.network,
        record.intent.asset,
        record.intent.amountAtomic,
        record.createdAt,
        record.status,
        JSON.stringify(record),
        challengeHash
      );
  }

  private appendAudit(type: string, record: AuthorizationRecord, at: number): void {
    const previousRow = this.database
      .prepare("SELECT sequence, hash FROM audit_events ORDER BY sequence DESC LIMIT 1")
      .get();
    const previousHash =
      previousRow === undefined ? "0".repeat(64) : String(previousRow.hash);
    const sequence = previousRow === undefined ? 1 : Number(previousRow.sequence) + 1;
    const unsigned = {
      sequence,
      at,
      type,
      recordId: record.id,
      intentDigest: record.intentDigest,
      status: record.status,
      previousHash
    };
    this.database
      .prepare(
        `INSERT INTO audit_events (
          sequence, at, type, record_id, intent_digest, status, previous_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        unsigned.sequence,
        unsigned.at,
        unsigned.type,
        unsigned.recordId,
        unsigned.intentDigest,
        unsigned.status,
        unsigned.previousHash,
        digest(unsigned)
      );
  }

  private ensureAuditChainValid(): void {
    try {
      if (!this.verifyAuditChain()) {
        throw new Error("Authorization audit chain is invalid; refusing to use the database.");
      }
    } catch (error) {
      this.database.close();
      this.closed = true;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("audit chain is invalid") || message.includes("malformed audit event")) {
        throw new Error("Authorization audit chain is invalid; refusing to use the database.");
      }
      throw error;
    }
  }

  private requireRecord(id: string): AuthorizationRecord {
    const row = this.database
      .prepare("SELECT record_json FROM authorizations WHERE id = ?")
      .get(id);
    if (row === undefined) {
      throw new Error(`Authorization '${id}' was not found.`);
    }
    return decodeRecord(String(row.record_json));
  }

  private freezeRecord(record: AuthorizationRecord): AuthorizationRecord {
    return Object.freeze({
      ...record,
      intent: Object.freeze({ ...record.intent })
    });
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Authorization service is closed.");
    }
  }
}
