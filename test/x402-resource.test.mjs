import assert from "node:assert/strict";
import test from "node:test";
import { createMezoAgentIntegrationBrief } from "../dist/src/x402/resource.js";

const options = {
  endpoint: "https://relayguard.vercel.app/api/paid-resource",
  price: "$0.001",
  payTo: "0x840E5bBF20D725f581752f8A4021ADd730550d47"
};

test("paid Mezo x402 resource returns an actionable MUSD integration brief", () => {
  const brief = createMezoAgentIntegrationBrief(options);

  assert.equal(brief.ok, true);
  assert.equal(brief.resource.id, "mezo-musd-agent-integration-brief");
  assert.equal(brief.integration.network.caip2, "eip155:31611");
  assert.equal(brief.integration.payment.amount, "$0.001");
  assert.equal(brief.integration.payment.amountAtomic, "1000000000000000");
  assert.equal(brief.integration.payment.asset.symbol, "MUSD");
  assert.equal(brief.integration.payment.transferMethod, "Permit2");
  assert.equal(brief.integration.payment.approvalScope, "Approve only the exact requested MUSD amount.");
  assert.equal(brief.integration.endpoint.url, options.endpoint);
  assert.equal(brief.agentPlaybook.length, 5);
  assert.ok(brief.verificationChecklist.some((item) => item.includes("Testnet tokens")));
  assert.ok(brief.notes.assessment.includes("not a live chain health report"));
});

test("paid Mezo x402 resource rejects malformed configuration", () => {
  assert.throws(() => createMezoAgentIntegrationBrief({ ...options, price: "1 MUSD" }), /price/i);
  assert.throws(() => createMezoAgentIntegrationBrief({ ...options, endpoint: "/api/paid-resource" }), /endpoint/i);
  assert.throws(() => createMezoAgentIntegrationBrief({ ...options, payTo: "not-an-address" }), /recipient/i);
});
