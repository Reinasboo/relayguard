const byId = (id) => document.getElementById(id);
const records = [
  { label: "Customer invoice", amount: "1.00 MUSD", hash: "0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868" },
  { label: "Agent API access", amount: "0.001 MUSD", hash: "0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c" }
];
const payer = "0x2D6d690df41807910826e799A34D7fB418480828";
const merchant = "0x840E5bBF20D725f581752f8A4021ADd730550d47";
const short = (value) => `${value.slice(0, 10)}…${value.slice(-8)}`;
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(35_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
function showPayments(payments = records) {
  byId("payment-proofs").replaceChildren(...payments.map((payment) => {
    const card = element("article", "", "proof-card");
    const header = document.createElement("header");
    header.append(element("h3", payment.label), element("span", payment.verified ? "RPC VERIFIED" : payment.status === "mismatch" ? "EVIDENCE MISMATCH" : "NOT VERIFIED NOW", `proof-badge${payment.verified ? " verified" : ""}`));
    card.append(header, element("strong", payment.amount, "proof-amount"));
    const details = document.createElement("dl");
    for (const [label, value] of [["From", payer], ["To", merchant], ["Token", "Canonical Mezo Testnet MUSD"], ["Block", payment.blockNumber ?? "Refresh to verify"]]) {
      const text = element("dd", value.startsWith("0x") ? short(value) : value); text.title = value;
      details.append(element("dt", label), text);
    }
    const link = element("a", "Inspect transaction on Mezo ↗");
    link.href = `https://explorer.test.mezo.org/tx/${payment.hash}`; link.target = "_blank"; link.rel = "noopener noreferrer";
    card.append(details, link); return card;
  }));
}
async function loadEvidence() {
  const button = byId("refresh-evidence"); button.disabled = true;
  byId("evidence-status").classList.remove("error");
  byId("evidence-status").textContent = "Reading Mezo contracts and checking historical receipt events…";
  try {
    const body = await request("/api/mezo/evidence");
    byId("evidence-block").textContent = body.blockNumber;
    byId("evidence-time").textContent = `Checked ${new Date(body.observedAt).toLocaleTimeString()}`;
    byId("token-status").textContent = `${body.token.symbol} · ${body.token.decimals} decimals`;
    byId("evidence-status").textContent = `${body.payments.filter((item) => item.verified).length}/2 historical payments verified now. Chain and canonical MUSD contract verified. Results cache for 30 seconds.`;
    byId("raw-evidence").textContent = JSON.stringify(body, null, 2); showPayments(body.payments);
  } catch (error) {
    byId("evidence-status").classList.add("error");
    byId("evidence-status").textContent = `${error.message} Use the explorer links or retry.`;
    byId("evidence-block").textContent = "Unavailable"; byId("token-status").textContent = "Unverified now";
    byId("raw-evidence").textContent = "Fresh verification unavailable. No successful verification is implied."; showPayments();
  } finally { button.disabled = false; }
}
let scenario = "healthy", sequence = 0;
async function runPolicy() {
  const current = ++sequence;
  const button = byId("run-policy"); button.disabled = true;
  byId("policy-result").setAttribute("aria-busy", "true");
  const titles = { authorized: "Within spending policy", approval_required: "Human approval required", blocked: "Payment blocked", paused: "MUSD spending paused" };
  try {
    const amount = byId("preview-amount").value.trim();
    if (!/^\d+(?:\.\d{1,18})?$/.test(amount)) throw new Error("Enter a positive MUSD amount with at most 18 decimal places.");
    const [whole, fraction = ""] = amount.split(".");
    const amountAtomic = (BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))).toString();
    const body = await request("/api/mezo/policy-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, amountAtomic }) });
    if (current !== sequence) return;
    byId("policy-result").dataset.outcome = body.outcome; byId("decision-title").textContent = titles[body.outcome];
    byId("decision-reason").textContent = body.reason;
    byId("decision-risk").textContent = body.outcome === "paused" ? "02 · Protocol data unavailable: fail closed" : `02 · Example ICR ${Number(BigInt(body.icrAtomic) * 100n / 10n ** 18n)}%: Mezo risk rule applied`;
    byId("decision-next").textContent = body.outcome === "authorized" ? "03 · Separate explicit execution would still be required" : body.outcome === "approval_required" ? "03 · Wait for an assigned human operator" : "03 · Stop before signing or submission";
  } catch (error) { if (current === sequence) {
    byId("policy-result").dataset.outcome = "error";
    byId("decision-title").textContent = "Check the input";
    byId("decision-reason").textContent = error.message;
    byId("decision-risk").textContent = "02 · No policy decision available";
    byId("decision-next").textContent = "03 · Correct the amount or retry before continuing";
  } }
  finally { if (current === sequence) { button.disabled = false; byId("policy-result").removeAttribute("aria-busy"); } }
}
document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => {
  scenario = button.dataset.scenario;
  document.querySelectorAll("[data-scenario]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  void runPolicy();
}));
byId("run-policy").addEventListener("click", () => void runPolicy());
byId("refresh-evidence").addEventListener("click", () => void loadEvidence());
byId("inspect-x402").addEventListener("click", async () => {
  const button = byId("inspect-x402"), output = byId("x402-challenge"); button.disabled = true; output.classList.remove("hidden"); output.textContent = "Requesting the real protected endpoint…";
  try {
    const response = await fetch("/api/paid-resource", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const header = response.headers.get("payment-required");
    if (response.status !== 402 || !header) throw new Error(`Endpoint returned HTTP ${response.status}. No 402 challenge was verified. The deployment must enable X402_ENABLED and its facilitator.`);
    const challengeBytes = Uint8Array.from(atob(header), (character) => character.charCodeAt(0));
    const challenge = JSON.parse(new TextDecoder().decode(challengeBytes));
    output.textContent = `HTTP 402 PAYMENT REQUIRED\n${JSON.stringify(challenge, null, 2)}`;
  } catch (error) { output.textContent = error.message; } finally { button.disabled = false; }
});
showPayments(); void loadEvidence(); void runPolicy();
