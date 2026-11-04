import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage, type Hex } from "viem";

interface CheckoutClaims {
  readonly kind: "challenge" | "session";
  readonly invoiceId: string;
  readonly payer: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly authorizationId?: string;
}

/** Stateless, purpose-bound capabilities. The signing key stays on the server. */
export class CheckoutSecurity {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("Checkout signing secret must contain at least 32 characters.");
  }

  private encode(claims: CheckoutClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`;
  }

  private decode(token: unknown, kind: CheckoutClaims["kind"], invoiceId: string, now: number): CheckoutClaims {
    if (typeof token !== "string" || token.length > 2048) throw new Error("Checkout proof is required.");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Invalid checkout proof.");
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid checkout proof.");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CheckoutClaims;
    if (claims.kind !== kind || claims.invoiceId !== invoiceId || !Number.isFinite(claims.expiresAt) || now >= claims.expiresAt) {
      throw new Error("Checkout proof expired or does not match this invoice.");
    }
    return claims;
  }

  private message(claims: CheckoutClaims): string {
    return ["RelayGuard checkout ownership verification", `Invoice: ${claims.invoiceId}`,
      `Payer: ${claims.payer}`, "Network: Mezo Testnet (31611)", `Attempt: ${claims.attemptId}`,
      `Expires: ${new Date(claims.expiresAt).toISOString()}`,
      "This signature verifies your wallet. It does not transfer tokens or grant an allowance."].join("\n");
  }

  challenge(invoiceId: string, payer: string, now = Date.now()) {
    const claims: CheckoutClaims = { kind: "challenge", invoiceId, payer: getAddress(payer),
      attemptId: randomUUID(), expiresAt: now + 5 * 60_000 };
    return { challenge: this.encode(claims), message: this.message(claims), expiresAt: claims.expiresAt };
  }

  async verify(challenge: unknown, signature: unknown, invoiceId: string, payer: string, now = Date.now()) {
    const claims = this.decode(challenge, "challenge", invoiceId, now);
    if (claims.payer !== getAddress(payer) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature) ||
        !await verifyMessage({ address: getAddress(payer), message: this.message(claims), signature: signature as Hex })) {
      throw new Error("Checkout signature does not prove ownership of the payer wallet.");
    }
    return claims.attemptId;
  }

  session(invoiceId: string, payer: string, authorizationId: string, expiresAt: number): string {
    return this.encode({ kind: "session", invoiceId, payer: getAddress(payer), authorizationId,
      attemptId: authorizationId, expiresAt });
  }

  requireSession(token: unknown, invoiceId: string, authorizationId: string, now = Date.now()): string {
    const claims = this.decode(token, "session", invoiceId, now);
    if (claims.authorizationId !== authorizationId) throw new Error("Checkout proof does not match this authorization.");
    return claims.payer;
  }
}
