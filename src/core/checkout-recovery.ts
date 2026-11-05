import type { CheckoutInvoice } from "./checkout.js";
import type { AuthorizationStore } from "./stores.js";

/** Resume only from a durable, exactly bound invoice hash. Never broadcasts. */
export async function reconcileInvoiceSubmission(invoice: CheckoutInvoice, authorization: AuthorizationStore): Promise<void> {
  if (invoice.status !== "submitted" || !invoice.authorizationId || !invoice.transactionReference) return;
  let record = await authorization.get(invoice.authorizationId);
  if (record.intent.asset !== invoice.asset || record.intent.amountAtomic !== invoice.amountAtomic ||
      record.intent.recipient.toLowerCase() !== invoice.merchantAddress.toLowerCase() ||
      (record.transactionReference && record.transactionReference.toLowerCase() !== invoice.transactionReference.toLowerCase())) {
    throw new Error("Invoice transaction does not match its authorization.");
  }
  if (record.status === "authorized") record = await authorization.markExecuting(record.id);
  if (record.status === "executing") {
    await authorization.markSubmitted(record.id, Date.now(), invoice.transactionReference);
  }
}
