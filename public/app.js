import { payForRelayguardResource } from "./x402-client.js";
import { discoverWalletProviders, selectSingleWallet } from "./wallet-provider.js";
import {
  getMezoTroveOpeningTerms,
  inspectMezoCheckoutWallet,
  MEZO_TESTNET_MUSD,
  openMezoTestnetTrove,
  quoteMezoTroveOpen
} from "./mezo-client.js";

const byId = (id) => document.getElementById(id);
const API_TIMEOUT_MS = 15_000;

let walletState;
let currentRecord;
let currentChallenge;
let currentHash;
let checkoutInvoice;
let checkoutAuthorization;
let checkoutWallet;
let checkoutProvider;
let checkoutBorrowQuote;
let checkoutVerificationInProgress = false;
let appConfig;
let appConfigPromise;
let authSession;
let operatorAccess = false;
let checkoutToken;
let healthLoadSequence = 0;
let auditLoadSequence = 0;
let merchantLoadSequence = 0;
let merchantInvoices = [];

async function requestWalletProvider() {
  const wallets = await discoverWalletProviders();
  if (!wallets.length) {
    throw new Error("No EVM wallet was detected. Install or enable MetaMask, then reload this page.");
  }
  const singleWallet = selectSingleWallet(wallets);
  if (singleWallet) return singleWallet;

  const dialog = byId("wallet-picker");
  const options = byId("wallet-picker-options");
  options.replaceChildren();
  let selectedWallet;
  for (const wallet of wallets) {
    const button = document.createElement("button");
    button.className = "button button-quiet wallet-picker-option";
    button.type = "button";
    button.textContent = wallet.name;
    button.addEventListener("click", () => {
      selectedWallet = wallet;
      dialog.close();
    });
    options.append(button);
  }
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(selectedWallet), { once: true });
    dialog.showModal();
  }).then((wallet) => {
    if (!wallet) throw new Error("Wallet connection was cancelled.");
    return wallet;
  });
}

try {
  authSession = JSON.parse(localStorage.getItem("relayguard.authSession") || "null");
  if (authSession) {
    authSession = {
      access_token: authSession.access_token,
      refresh_token: authSession.refresh_token,
      expires_at: authSession.expires_at,
      token_type: authSession.token_type
    };
    localStorage.setItem("relayguard.authSession", JSON.stringify(authSession));
  }
} catch {
  localStorage.removeItem("relayguard.authSession");
}

async function saveMerchantName() {
  const merchantName = byId("merchant-display-name").value.trim();
  if (!merchantName || merchantName.length > 120) {
    toast("Enter a store name between 1 and 120 characters.", "error");
    return;
  }
  const button = byId("merchant-name-save");
  button.disabled = true;
  try {
    await api("/api/merchant/profile", {
      method: "POST",
      body: JSON.stringify({ merchantName })
    });
    byId("merchant-name").textContent = merchantName;
    toast("Store name saved for new checkouts.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = byId("merchant-wallet-connect").dataset.walletVerified !== "true";
  }
}

function persistAuthSession(session) {
  authSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: session.token_type
  };
  localStorage.setItem("relayguard.authSession", JSON.stringify(authSession));
}

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(path, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Check your connection and retry.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function restoreAuthRedirect() {
  const values = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = values.get("access_token");
  const refreshToken = values.get("refresh_token");
  if (!accessToken || !refreshToken) return;
  persistAuthSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer"
  });
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

restoreAuthRedirect();

function toast(message, kind = "info") {
  const element = byId("toast");
  element.textContent = message;
  element.className = `toast visible ${kind}`;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    element.className = "toast";
  }, 4200);
}

function showX402Progress(message) {
  const result = byId("x402-result");
  const status = document.createElement("p");
  status.className = "x402-result-progress";
  status.textContent = message;
  result.replaceChildren(status);
  result.classList.remove("hidden");
}

function renderX402Result(body, settlement) {
  if (typeof body !== "object" || body === null || !("resource" in body) || !("integration" in body)) {
    throw new Error("The payment settled, but the protected resource returned an unexpected response.");
  }
  const resource = body.resource;
  const integration = body.integration;
  if (
    typeof resource !== "object" || resource === null ||
    typeof integration !== "object" || integration === null ||
    typeof resource.title !== "string" || typeof resource.summary !== "string" ||
    typeof integration.network !== "object" || integration.network === null ||
    typeof integration.payment !== "object" || integration.payment === null ||
    typeof integration.endpoint !== "object" || integration.endpoint === null ||
    !Array.isArray(body.agentPlaybook) || !Array.isArray(body.verificationChecklist)
  ) {
    throw new Error("The payment settled, but the protected resource returned an incomplete integration brief.");
  }

  const result = byId("x402-result");
  result.replaceChildren();
  const header = document.createElement("div");
  header.className = "x402-result-header";
  const check = document.createElement("span");
  check.className = "x402-result-check";
  check.textContent = "✓";
  const heading = document.createElement("div");
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "PAYMENT SETTLED · RESOURCE UNLOCKED";
  const title = document.createElement("h3");
  title.textContent = resource.title;
  heading.append(statusLabel, title);
  header.append(check, heading);
  result.append(header);

  const summary = document.createElement("p");
  summary.className = "x402-result-summary";
  summary.textContent = resource.summary;
  result.append(summary);

  const network = integration.network;
  const payment = integration.payment;
  const asset = payment.asset;
  if (
    typeof network !== "object" || network === null ||
    typeof payment !== "object" || payment === null ||
    typeof asset !== "object" || asset === null ||
    typeof integration.endpoint !== "object" || integration.endpoint === null
  ) {
    throw new Error("The payment settled, but the integration details are incomplete.");
  }
  const grid = document.createElement("div");
  grid.className = "x402-result-grid";
  for (const [label, value] of [
    ["NETWORK", `${network.name} · ${network.caip2}`],
    ["PAYMENT", `${payment.amount} ${asset.symbol} · ${payment.scheme}`],
    ["MUSD TOKEN", asset.address],
    ["TRANSFER", `${payment.transferMethod} · exact-amount approval`],
    ["RECIPIENT", payment.recipient],
    ["PROTECTED API", `${integration.endpoint.method} ${new URL(integration.endpoint.url).pathname}`]
  ]) {
    const item = document.createElement("div");
    item.className = "x402-result-item";
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = String(value);
    item.append(labelElement, valueElement);
    grid.append(item);
  }
  result.append(grid);

  const steps = document.createElement("ol");
  steps.className = "x402-result-steps";
  for (const entry of body.agentPlaybook) {
    if (typeof entry !== "object" || entry === null || !("action" in entry) || typeof entry.action !== "string") continue;
    const item = document.createElement("li");
    item.textContent = entry.action;
    steps.append(item);
  }
  const playbook = document.createElement("details");
  const playbookSummary = document.createElement("summary");
  playbookSummary.textContent = "Open the agent integration playbook";
  playbook.append(playbookSummary, steps);
  result.append(playbook);

  const checklist = document.createElement("ul");
  checklist.className = "x402-result-checklist";
  for (const entry of body.verificationChecklist) {
    if (typeof entry !== "string") continue;
    const item = document.createElement("li");
    item.textContent = entry;
    checklist.append(item);
  }
  const checklistDetails = document.createElement("details");
  const checklistSummary = document.createElement("summary");
  checklistSummary.textContent = "Security checklist";
  checklistDetails.append(checklistSummary, checklist);
  result.append(checklistDetails);

  if (!/^0x[0-9a-fA-F]{64}$/.test(settlement)) {
    throw new Error("The resource was unlocked, but the facilitator returned an invalid settlement reference.");
  }
  const receipt = document.createElement("a");
  receipt.className = "x402-result-receipt";
  receipt.href = `https://explorer.test.mezo.org/tx/${settlement}`;
  receipt.target = "_blank";
  receipt.rel = "noreferrer noopener";
  receipt.textContent = `View confirmed Mezo settlement · ${settlement.slice(0, 10)}…${settlement.slice(-8)} ↗`;
  result.append(receipt);

  const jsonDetails = document.createElement("details");
  const jsonSummary = document.createElement("summary");
  jsonSummary.textContent = "View raw JSON for agent clients";
  const json = document.createElement("pre");
  json.className = "x402-result-json";
  json.textContent = JSON.stringify(body, null, 2);
  jsonDetails.append(jsonSummary, json);
  result.append(jsonDetails);
  result.classList.remove("hidden");
}

async function api(path, options = {}) {
  const requestHeaders = () => ({
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(authSession?.access_token ? { authorization: `Bearer ${authSession.access_token}` } : {}),
    ...options.headers
  });
  let response = await fetchWithTimeout(path, {
    ...options,
    headers: requestHeaders()
  });
  if (response.status === 401 && authSession?.refresh_token && path !== "/api/config") {
    if (!appConfig?.supabase) await ensureAppConfig();
  }
  if (
    response.status === 401 &&
    authSession?.refresh_token &&
    appConfig?.supabase &&
    path !== "/api/config"
  ) {
    const refreshed = await fetchWithTimeout(`${appConfig.supabase.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: appConfig.supabase.publishableKey
      },
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    if (refreshed.ok) {
      persistAuthSession(await refreshed.json());
      response = await fetchWithTimeout(path, { ...options, headers: requestHeaders() });
    } else {
      authSession = undefined;
      localStorage.removeItem("relayguard.authSession");
      renderAuthState("Your merchant session expired. Sign in again to continue.");
    }
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const message = (await response.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const error = new Error(message
      ? `Server returned HTTP ${response.status} instead of JSON: ${message}`
      : `Server returned HTTP ${response.status} without a JSON response.`);
    error.status = response.status;
    throw error;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    const error = new Error(`Server returned invalid JSON (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!response.ok && response.status !== 202) {
    const error = new Error(body.error || "The request could not be completed.");
    error.code = body.code;
    error.details = body;
    error.status = response.status;
    throw error;
  }
  return { status: response.status, body };
}

function shortAddress(address) {
  return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—";
}

function setStep(id, state, label) {
  const element = byId(id);
  element.classList.remove("active", "complete", "error");
  element.classList.add(state);
  const indicator = element.querySelector(".step-state");
  if (indicator && label) indicator.textContent = label;
}

function showError(message) {
  const area = byId("action-area");
  area.classList.remove("hidden");
  area.innerHTML = "";
  const notice = document.createElement("div");
  notice.className = "inline-error";
  notice.textContent = message;
  area.append(notice);
  toast(message, "error");
}

function addDetail(container, label, value, options = {}) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const title = document.createElement("span");
  title.className = "detail-label";
  title.textContent = label;
  const content = document.createElement(options.mono ? "code" : "span");
  content.className = options.mono ? "detail-value mono" : "detail-value";
  content.textContent = value;
  row.append(title, content);
  container.append(row);
}

function actionButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function formatIntentAmount(intent) {
  if (!intent) return "—";
  const decimals = intent.asset === "BTC"
    ? 18
    : (walletState?.musd?.decimals ?? 18);
  const value = BigInt(intent.amountAtomic);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${intent.asset}`;
}

function renderTransaction(record, details = {}) {
  currentRecord = record;
  currentHash = details.transactionHash || record.transactionReference || currentHash;
  localStorage.setItem("relayguard.currentPayment", record.id);
  byId("transaction-empty").classList.add("hidden");
  const panel = byId("transaction-details");
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const intent = record.intent;
  addDetail(panel, "Authorization", record.status.replaceAll("_", " ").toUpperCase());
  addDetail(panel, "Amount", formatIntentAmount(intent));
  addDetail(panel, "Recipient", intent.recipient, { mono: true });
  addDetail(panel, "Purpose", intent.purpose);
  if (record.reason) addDetail(panel, "Policy result", record.reason.replaceAll("_", " "));
  for (const [index, evidence] of (record.mezoTroveEvidence || []).entries()) {
    const observed = new Date(evidence.observedAt).toLocaleString();
    addDetail(
      panel,
      `Mezo policy snapshot ${index + 1}`,
      `${evidence.risk.replaceAll("_", " ")} · block ${evidence.blockNumber} · ${observed}`
    );
    addDetail(panel, "Trove borrower", evidence.borrower, { mono: true });
    addDetail(panel, "BTC/USD at decision", `$${formatDisplayAtomic(evidence.priceAtomic)}`);
    if (evidence.icrAtomic) {
      addDetail(panel, "Collateral ratio", `${formatDisplayAtomic(evidence.icrAtomic, 2, 16)}%`);
    }
    if (evidence.collateralAtomic) {
      addDetail(panel, "BTC collateral", `${formatDisplayAtomic(evidence.collateralAtomic)} BTC`);
    }
    if (evidence.debtAtomic) {
      addDetail(panel, "MUSD debt", `${formatDisplayAtomic(evidence.debtAtomic)} MUSD`);
    }
  }
  if (details.transactionHash || currentHash) {
    const hash = details.transactionHash || currentHash;
    currentHash = hash;
    addDetail(panel, "Transaction hash", hash, { mono: true });
    const explorer = document.createElement("a");
    explorer.className = "explorer-link";
    explorer.href = `https://explorer.test.mezo.org/tx/${encodeURIComponent(hash)}`;
    explorer.target = "_blank";
    explorer.rel = "noreferrer noopener";
    explorer.textContent = "View on Mezo explorer ↗";
    panel.append(explorer);
  }

  const status = byId("payment-status");
  status.textContent = record.status.replaceAll("_", " ").toUpperCase();
  status.className = `status-pill ${record.status === "confirmed" ? "success" : record.status === "denied" || record.status === "failed" ? "danger" : "pending"}`;
  const actions = byId("action-area");
  actions.classList.remove("hidden");
  actions.innerHTML = "";

  if (record.status === "awaiting_approval") {
    byId("human-status").textContent = " · required";
    setStep("step-intent", "complete", "RECEIVED");
    setStep("step-policy", "complete", "REVIEW");
    setStep("step-human", "active");
    if (currentChallenge) {
      actions.append(actionButton("Approve this exact intent", "button button-approve", approvePayment));
      actions.append(actionButton("Reject", "button button-quiet", rejectPayment));
    } else {
      const note = document.createElement("p");
      note.className = "action-caption";
      note.textContent = "The one-time approval challenge is unavailable in this tab. Cancel this request and submit a fresh intent.";
      actions.append(note);
    }
    actions.append(actionButton("Cancel request", "button button-quiet", cancelPayment));
  } else if (record.status === "authorized") {
    byId("human-status").textContent = " · not required or approved";
    setStep("step-intent", "complete", "RECEIVED");
    setStep("step-policy", "complete", "AUTHORIZED");
    setStep("step-human", "complete");
    setStep("step-submit", "active");
    actions.append(actionButton("Execute on Mezo testnet", "button button-primary", executePayment));
    const note = document.createElement("p");
    note.className = "action-caption";
    note.textContent = "This signs and broadcasts a real testnet transaction and spends BTC on network fees.";
    actions.append(note);
    actions.append(actionButton("Cancel authorization", "button button-quiet", cancelPayment));
  } else if (record.status === "submitted") {
    setStep("step-intent", "complete", "RECEIVED");
    setStep("step-policy", "complete", "AUTHORIZED");
    setStep("step-human", "complete");
    setStep("step-submit", "complete", "SUBMITTED");
    setStep("step-verify", "active");
    actions.append(actionButton("Verify receipt from Mezo RPC", "button button-primary", verifyPayment));
    const note = document.createElement("p");
    note.className = "action-caption";
    note.textContent = "The payment is not marked successful until the chain receipt is confirmed.";
    actions.append(note);
  } else if (record.status === "confirmed") {
    setStep("step-intent", "complete", "RECEIVED");
    setStep("step-policy", "complete", "AUTHORIZED");
    setStep("step-human", "complete");
    setStep("step-submit", "complete", "SUBMITTED");
    setStep("step-verify", "complete", "CONFIRMED");
    const success = document.createElement("div");
    success.className = "success-message";
    success.textContent = "Settlement confirmed by Mezo RPC.";
    actions.append(success);
  } else if (record.status === "denied" || record.status === "failed" || record.status === "cancelled" || record.status === "expired") {
    setStep("step-policy", "error", "DENIED");
    const failed = document.createElement("div");
    failed.className = "inline-error";
    failed.textContent = record.reason || `Payment ${record.status}.`;
    actions.append(failed);
  }
  loadAudit().catch((error) => console.error("Audit refresh failed:", error));
}

async function loadHealth() {
  const loadSequence = ++healthLoadSequence;
  const wasSignedIn = Boolean(authSession?.access_token);
  if (wasSignedIn) {
    try { operatorAccess = (await api("/api/session")).body.operator; } catch { operatorAccess = false; }
  } else operatorAccess = false;
  const endpoint = operatorAccess ? "/api/health/details" : "/api/health/console";
  byId("network-label").textContent = "Loading Mezo snapshot…";
  byId("network-status").textContent = "READING";
  byId("network-status").className = "status-pill pending";
  byId("trove-status").textContent = "Reading protocol state…";
  byId("trove-status").className = "status-pill pending";

  const renderSnapshot = (snapshot) => {
    if (loadSequence !== healthLoadSequence) return;
    byId("network-label").textContent = snapshot.network;
    byId("network-status").textContent = "CONNECTED";
    byId("network-status").className = "status-pill success";
    byId("chain-name").textContent = snapshot.network;
    byId("chain-id").textContent = String(snapshot.chainId);
    byId("block-number").textContent = snapshot.blockNumber;
    walletState = snapshot;
    renderHealthDetails(snapshot);
  };

  try {
    const { body: snapshot } = await api(endpoint);
    if (loadSequence !== healthLoadSequence) return;
    renderSnapshot(snapshot);
    if (operatorAccess) void loadAudit();
  } catch (error) {
    if (loadSequence !== healthLoadSequence) return;
    if (wasSignedIn) {
      try {
        const { body: publicSnapshot } = await api("/api/health/console");
        if (loadSequence !== healthLoadSequence) return;
        renderSnapshot(publicSnapshot);
        if (authSession?.access_token) {
          const notice = byId("setup-notice");
          notice.classList.remove("hidden");
          notice.textContent = "Read-only operator status is shown. Protected payment controls and policy details could not be loaded.";
          byId("request-button").disabled = true;
          console.error("Protected Mezo health details could not be loaded:", error);
        }
      } catch (publicError) {
        if (loadSequence !== healthLoadSequence) return;
        renderHealthUnavailable(publicError);
      }
      return;
    }
    if (wasSignedIn !== Boolean(authSession?.access_token)) return;
    renderHealthUnavailable(error);
  }
}

function renderHealthUnavailable(error) {
  byId("network-status").textContent = "UNAVAILABLE";
  byId("network-status").className = "status-pill danger";
  byId("network-label").textContent = "Mezo status unavailable";
  byId("chain-name").textContent = "Mezo Testnet";
  byId("chain-id").textContent = "—";
  byId("block-number").textContent = "—";
  byId("native-balance").textContent = "— BTC";
  byId("wallet-address").textContent = "Operator status unavailable";
  byId("musd-card").classList.add("hidden");
  byId("trove-status").textContent = "Protocol data unavailable";
  byId("trove-status").className = "status-pill danger";
  byId("trove-icr").textContent = "—";
  byId("trove-collateral").textContent = "—";
  byId("trove-debt").textContent = "—";
  byId("trove-policy").textContent = "Latest protocol data could not be read; payment controls are paused.";
  byId("request-button").disabled = true;
  const notice = byId("setup-notice");
  notice.classList.remove("hidden");
  notice.replaceChildren(
    document.createTextNode("Mezo protocol status could not be loaded. Payment controls are paused; retry when the RPC is available. "),
    actionButton("Retry status", "button button-quiet", () => void loadHealth())
  );
  console.error("Mezo protocol snapshot could not be loaded:", error);
}

function renderHealthDetails(body) {
  const nativeBalance = byId("native-balance");
  nativeBalance.replaceChildren(document.createTextNode(Number(body.nativeBalance).toFixed(6)));
  const unit = document.createElement("small");
  unit.textContent = ` ${body.nativeAsset}`;
  nativeBalance.append(unit);
  byId("wallet-address").textContent = `${shortAddress(body.wallet)} · operator signer`;
  byId("wallet-address").title = body.wallet;
  if (body.musd) {
    const amount = BigInt(body.musd.balanceAtomic);
    const decimals = BigInt(body.musd.decimals);
    const divisor = 10n ** decimals;
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(Number(decimals), "0").slice(0, 6);
    const balance = byId("musd-balance");
    balance.replaceChildren(document.createTextNode(`${whole}.${fraction}`));
    const musdUnit = document.createElement("small");
    musdUnit.textContent = " MUSD";
    balance.append(musdUnit);
    byId("musd-contract").textContent = shortAddress(body.musd.address);
    byId("musd-contract").title = body.musd.address;
    byId("musd-card").classList.remove("hidden");
  } else {
    byId("musd-card").classList.add("hidden");
    byId("musd-balance").textContent = "— MUSD";
    byId("musd-contract").textContent = "Verified testnet token contract";
  }
  renderTroveHealth(body.trove);

  const recipientSelect = byId("recipient");
  recipientSelect.replaceChildren();
  if (body.policy?.configuredRecipients?.length) {
    for (const recipient of body.policy.configuredRecipients) {
      const option = document.createElement("option");
      option.value = recipient;
      option.textContent = `${shortAddress(recipient)}${recipient.toLowerCase() === body.wallet.toLowerCase() ? " · own wallet" : ""}`;
      option.title = recipient;
      recipientSelect.append(option);
    }
    byId("request-button").disabled = false;
    byId("setup-notice").classList.add("hidden");
  } else {
    const signedIn = Boolean(authSession?.access_token);
    recipientSelect.append(new Option(
      signedIn ? "No destinations configured" : "Sign in to load approved destinations",
      ""
    ));
    byId("request-button").disabled = true;
    const notice = byId("setup-notice");
    notice.classList.remove("hidden");
    notice.textContent = signedIn
      ? "Payments are paused until an approved recipient is configured."
      : "Read-only public status. Sign in to view protected spending configuration and recipient settings and use payment controls.";
  }

  function renderTroveHealth(trove) {
    const status = byId("trove-status");
    const ratio = byId("trove-icr");
    const collateral = byId("trove-collateral");
    const debt = byId("trove-debt");
    const policy = byId("trove-policy");
    if (!trove || trove.status === "unavailable") {
      status.textContent = "Trove state unavailable";
      status.className = "status-pill danger";
      ratio.textContent = "—";
      collateral.textContent = "—";
      debt.textContent = "—";
      policy.textContent = "MUSD authorization is paused until protocol state can be verified.";
      return;
    }
    if (trove.status === "inactive") {
      status.textContent = "No active trove";
      status.className = "status-pill muted";
      ratio.textContent = "—";
      collateral.textContent = "—";
      debt.textContent = "—";
      policy.textContent = "Standard MUSD spending limits apply; no active trove was found for this signer.";
      return;
    }
    const icr = Number(formatAtomic(trove.icrAtomic));
    ratio.textContent = `${(icr * 100).toFixed(1)}%`;
    collateral.textContent = `${formatDisplayAtomic(trove.collateralAtomic, 4)} BTC`;
    debt.textContent = `${formatDisplayAtomic(trove.debtAtomic, 2)} MUSD`;
    collateral.title = `${formatAtomic(trove.collateralAtomic)} BTC`;
    debt.title = `${formatAtomic(trove.debtAtomic)} MUSD`;
    if (trove.risk === "healthy") {
      status.textContent = "Healthy";
      status.className = "status-pill success";
      policy.textContent = "Standard MUSD spending limits apply while the trove remains above the 150% review buffer.";
    } else if (trove.risk === "review_required") {
      status.textContent = "Human review required";
      status.className = "status-pill pending";
      policy.textContent = "Every MUSD payment requires explicit human approval while the trove is between 110% and 150% ICR.";
    } else {
      status.textContent = "MUSD spending paused";
      status.className = "status-pill danger";
      policy.textContent = "New MUSD authorizations, approvals, and executions are blocked below the 110% minimum collateral ratio.";
    }
  }

  if (body.musd) {
    if (!byId("asset").querySelector('option[value="MUSD"]')) {
      byId("asset").append(new Option("MUSD · Mezo Testnet", "MUSD"));
    }
    byId("amount-unit").textContent = "BTC";
  } else {
    byId("asset").querySelector('option[value="MUSD"]')?.remove();
    byId("asset").value = "BTC";
    byId("amount-unit").textContent = "BTC";
    const notice = byId("setup-notice");
    notice.classList.remove("hidden");
    notice.textContent = body.policy
      ? "MUSD payments are temporarily unavailable."
      : "MUSD status is unavailable; this public dashboard is read-only. Sign in for payment controls.";
    byId("request-button").disabled = true;
  }
}

function updateUnit() {
  byId("amount-unit").textContent = byId("asset").value;
}

async function loadAudit() {
  const loadSequence = ++auditLoadSequence;
  if (!authSession?.access_token || !operatorAccess) {
    byId("audit-state").textContent = "Operator access";
    byId("audit-state").className = "stat-value compact";
    byId("audit-events").textContent = "The shared treasury audit is restricted to assigned operators. Your invoices appear in the merchant workspace.";
    byId("refresh-audit").disabled = true;
    return;
  }
  const list = byId("audit-events");
  byId("refresh-audit").disabled = true;
  byId("audit-state").textContent = "Loading…";
  byId("audit-state").className = "stat-value compact";
  list.setAttribute("aria-busy", "true");
  if (!list.children.length) list.textContent = "Loading audit trail…";
  try {
    const { body } = await api("/api/audit");
    if (loadSequence !== auditLoadSequence || !authSession?.access_token) return;
    byId("audit-state").textContent = body.verified ? "Integrity verified" : "Integrity error";
    byId("audit-state").className = `stat-value compact ${body.verified ? "text-good" : "text-bad"}`;
    list.innerHTML = "";
    if (!body.events.length) {
      list.innerHTML = '<div class="audit-empty">No recorded decisions yet.</div>';
      return;
    }
    for (const event of body.events) {
      const item = document.createElement("div");
      item.className = "audit-event";
      const icon = document.createElement("span");
      icon.className = "audit-icon";
      icon.textContent = event.status === "confirmed" ? "✓" : "⌁";
      const copy = document.createElement("div");
      copy.className = "audit-copy";
      const title = document.createElement("strong");
      title.textContent = event.type.replaceAll("_", " ");
      const meta = document.createElement("small");
      const commitments = [
        event.policyDigest ? `policy ${event.policyDigest.slice(0, 8)}` : "",
        event.mezoTroveEvidenceDigest
          ? `Mezo evidence ${event.mezoTroveEvidenceDigest.slice(0, 8)}`
          : ""
      ].filter(Boolean);
      meta.textContent = [
        new Date(event.at).toLocaleTimeString(),
        event.status.replaceAll("_", " "),
        ...commitments
      ].join(" · ");
      copy.append(title, meta);
      const sequence = document.createElement("span");
      sequence.className = "audit-sequence";
      sequence.textContent = `#${event.sequence}`;
      item.append(icon, copy, sequence);
      list.append(item);
    }
  } catch (error) {
    if (loadSequence !== auditLoadSequence) return;
    if (!authSession?.access_token) {
      byId("audit-state").textContent = "Sign-in required";
      byId("audit-state").className = "stat-value compact";
      list.textContent = "Sign in to your merchant account to view the authorization audit.";
      return;
    }
    console.error("Authorization audit could not be loaded:", error);
    byId("audit-state").textContent = "Unavailable";
    byId("audit-state").className = "stat-value compact text-bad";
    list.replaceChildren();
    const message = document.createElement("div");
    message.className = "audit-empty";
    message.textContent = `Audit trail could not be loaded: ${error.message}`;
    list.append(message, actionButton("Retry", "button button-quiet", () => void loadAudit()));
  } finally {
    if (loadSequence === auditLoadSequence) {
      list.removeAttribute("aria-busy");
      byId("refresh-audit").disabled = !authSession?.access_token;
    }
  }
}

function ensureAppConfig() {
  if (!appConfigPromise) appConfigPromise = loadAppConfig();
  return appConfigPromise;
}

async function requestPayment(event) {
  event.preventDefault();
  if (!authSession?.access_token) {
    const notice = byId("setup-notice");
    notice.classList.remove("hidden");
    notice.textContent = "Sign in to use payment controls. The public operator dashboard is read-only.";
    return;
  }
  const button = byId("request-button");
  const label = button.querySelector("span");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (label) label.textContent = "Checking policy…";
  try {
    const { body } = await api("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        asset: byId("asset").value,
        recipient: byId("recipient").value,
        amount: byId("amount").value.trim(),
        purpose: byId("purpose").value.trim(),
        idempotencyKey: crypto.randomUUID()
      })
    });
    currentChallenge = body.approvalChallenge;
    currentHash = undefined;
    renderTransaction(body.record);
    toast(body.message || "Payment intent recorded.", "success");
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = !authSession?.access_token ||
      !walletState?.policy?.configuredRecipients?.length;
    button.removeAttribute("aria-busy");
    if (label) label.textContent = "Check policy & prepare";
  }
}

async function approvePayment() {
  if (!currentRecord || !currentChallenge) {
    showError("Approval challenge is missing. Submit a fresh payment intent.");
    return;
  }
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(currentRecord.id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ challenge: currentChallenge })
    });
    currentChallenge = undefined;
    renderTransaction(body.record);
    toast(body.message, "success");
  } catch (error) {
    if (error.details?.stalePolicy && error.details.record) {
      currentChallenge = undefined;
      renderTransaction(error.details.record);
      const notice = document.createElement("div");
      notice.className = "inline-error";
      notice.textContent = error.message;
      byId("action-area").prepend(notice);
    } else {
      showError(error.message);
    }
  }
}

async function rejectPayment() {
  if (!currentRecord) return;
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(currentRecord.id)}/reject`, { method: "POST" });
    currentChallenge = undefined;
    renderTransaction(body.record);
    toast(body.message, "success");
  } catch (error) {
    showError(error.message);
  }
}

async function executePayment() {
  if (!currentRecord || currentRecord.status !== "authorized") return;
  const intent = currentRecord.intent;
  const approved = window.confirm(
    `Submit this real Mezo testnet transaction?\n\n${formatIntentAmount(intent)}\nTo: ${intent.recipient}\n\nThis spends testnet BTC for network fees.`
  );
  if (!approved) return;
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(currentRecord.id)}/execute`, { method: "POST" });
    currentHash = body.transactionHash;
    renderTransaction(body.record, body);
    toast(body.message, "success");
  } catch (error) {
    if (error.status === 409 && currentRecord?.status === "authorized") {
      renderTransaction(currentRecord);
      const notice = document.createElement("div");
      notice.className = "inline-error";
      notice.textContent = error.message;
      byId("action-area").prepend(notice);
    } else {
      showError(error.message);
    }
  }
}

async function cancelPayment() {
  if (!currentRecord || !["authorized", "awaiting_approval"].includes(currentRecord.status)) return;
  if (!window.confirm("Cancel this authorization? It will release the reserved daily limit and will not submit a payment.")) return;
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(currentRecord.id)}/cancel`, { method: "POST" });
    currentChallenge = undefined;
    renderTransaction(body.record);
    toast(body.message, "success");
  } catch (error) {
    showError(error.message);
  }
}

async function verifyPayment() {
  if (!currentRecord) return;
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(currentRecord.id)}/verify`, { method: "POST" });
    renderTransaction(body.record, { transactionHash: currentHash });
    if (body.evidence?.state === "confirmed") {
      toast("Settlement verified from the Mezo testnet receipt.", "success");
    } else if (body.evidence?.state === "failed") {
      toast("Mezo reports that the transaction reverted.", "error");
    } else {
      toast("Receipt is not confirmed yet. Check again shortly.");
    }
  } catch (error) {
    showError(error.message);
  }
}

async function restoreCurrentPayment() {
  const recordId = localStorage.getItem("relayguard.currentPayment");
  if (!recordId) return;
  try {
    const { body } = await api(`/api/payments/${encodeURIComponent(recordId)}`);
    currentHash = body.record.transactionReference;
    renderTransaction(body.record);
  } catch {
    localStorage.removeItem("relayguard.currentPayment");
  }
}

byId("payment-form").addEventListener("submit", requestPayment);
byId("checkout-borrow-review").addEventListener("click", () => void reviewTroveOpen());
byId("checkout-borrow-collateral").addEventListener("input", () => {
  checkoutBorrowQuote = undefined;
  byId("checkout-borrow-review-result").classList.add("hidden");
  byId("checkout-borrow-ack").checked = false;
  byId("checkout-borrow-ack-wrap").classList.add("hidden");
  byId("checkout-borrow-confirm").classList.add("hidden");
});
byId("checkout-borrow-ack").addEventListener("change", (event) => {
  byId("checkout-borrow-confirm").disabled = !event.currentTarget.checked || !checkoutBorrowQuote;
});
byId("checkout-borrow-confirm").addEventListener("click", () => void confirmTroveOpen());
byId("refresh-audit").addEventListener("click", () => loadAudit().catch((error) => toast(error.message, "error")));

function setView(view) {
  const isPayPage = window.location.pathname.startsWith("/pay/");
  byId("view-crumb").textContent = view === "faq"
    ? "Field guide"
    : view === "merchant"
      ? "Merchant workspace"
      : "Payment workspace";
  byId("console-view").classList.toggle("hidden", isPayPage || view !== "console");
  byId("merchant-view").classList.toggle("hidden", isPayPage || view !== "merchant");
  byId("faq-view").classList.toggle("hidden", isPayPage || view !== "faq");
  byId("checkout-view").classList.toggle("hidden", !isPayPage);
  document.querySelectorAll(".rail-link[data-view]").forEach((link) => {
    const active = link.dataset.view === view && !isPayPage;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  byId("rail")?.classList.toggle("hidden", isPayPage);
  byId("footer")?.classList.toggle("hidden", isPayPage);
}

function formatAtomic(atomic, decimals = 18) {
  const value = BigInt(atomic);
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function formatDisplayAtomic(atomic, fractionDigits = 2, decimals = 18) {
  const value = BigInt(atomic);
  const unit = 10n ** BigInt(decimals);
  const whole = (value / unit).toLocaleString("en-US");
  const fraction = (value % unit)
    .toString()
    .padStart(decimals, "0")
    .slice(0, fractionDigits)
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

async function loadMerchantWorkspace() {
  const loadSequence = ++merchantLoadSequence;
  const wasSignedIn = Boolean(authSession?.access_token);
  try {
    const { body: merchantBody } = await api("/api/merchant");
    if (loadSequence !== merchantLoadSequence) return;
    byId("merchant-name").textContent = merchantBody.name;
    byId("merchant-display-name").value = merchantBody.name;
    const isMerchantSignedIn = Boolean(authSession?.access_token);
    const walletVerified = isMerchantSignedIn && merchantBody.walletVerified && merchantBody.address;
    renderMerchantSetup(isMerchantSignedIn, Boolean(walletVerified), merchantInvoices.length > 0);
    byId("merchant-wallet-connect").dataset.walletVerified = String(Boolean(walletVerified));
    byId("merchant-address").textContent = walletVerified
      ? `${shortAddress(merchantBody.address)} · verified receiving wallet`
      : isMerchantSignedIn
        ? "Connect and verify your wallet to receive MUSD"
        : "Sign in and connect your own receiving wallet";
    byId("merchant-wallet-state").textContent = walletVerified
      ? `${merchantBody.address} · verified`
      : isMerchantSignedIn
        ? "No verified receiving wallet yet."
        : "Sign in to connect your wallet.";
    byId("merchant-wallet-connect").disabled = !isMerchantSignedIn;
    byId("merchant-wallet-connect").textContent = walletVerified ? "Change wallet" : "Connect & verify";
    byId("merchant-name-save").disabled = !walletVerified;
    byId("invoice-button").disabled = !walletVerified;
    byId("x402-resource-button").disabled = !walletVerified;
    byId("refresh-invoices").disabled = !walletVerified;
    if (!authSession?.access_token) {
      merchantInvoices = [];
      byId("invoice-list").textContent = "Sign in with Supabase to view your merchant invoices.";
      byId("merchant-x402-resources").textContent = "Sign in and verify your wallet to set up product integrations.";
      return;
    }
    if (!walletVerified) {
      merchantInvoices = [];
      byId("invoice-list").textContent = "Verify your own receiving wallet to create invoices.";
      byId("merchant-x402-resources").textContent = "Verify your receiving wallet to create x402 integrations.";
      return;
    }
    const results = await Promise.allSettled([
      loadMerchantInvoices(loadSequence),
      loadMerchantX402Resources(loadSequence)
    ]);
    if (loadSequence !== merchantLoadSequence) return;
    const resourceResult = results[1];
    if (resourceResult.status === "rejected" && authSession?.access_token) {
      renderMerchantX402LoadError(resourceResult.reason);
    }
  } catch (error) {
    if (loadSequence !== merchantLoadSequence) return;
    if (wasSignedIn && !authSession?.access_token) return;
    console.error("Merchant workspace could not be loaded:", error);
    byId("merchant-name").textContent = "Merchant unavailable";
    byId("merchant-address").textContent = "Retry loading the merchant workspace below";
    byId("invoice-button").disabled = true;
    byId("x402-resource-button").disabled = true;
    const list = byId("invoice-list");
    list.replaceChildren();
    const message = document.createElement("div");
    message.className = "audit-empty";
    message.textContent = `Invoices could not be loaded: ${error.message}`;
    list.append(message, actionButton("Retry", "button button-quiet", () => void loadMerchantWorkspace()));
  }
}

async function loadMerchantInvoices(workspaceSequence) {
  const list = byId("invoice-list");
  const refreshButton = byId("refresh-invoices");
  const sequence = workspaceSequence ?? merchantLoadSequence;
  if (!authSession?.access_token ||
      byId("merchant-wallet-connect").dataset.walletVerified !== "true") return;
  if (!list.children.length) list.textContent = "Loading invoices…";
  list.setAttribute("aria-busy", "true");
  refreshButton.disabled = true;
  refreshButton.setAttribute("aria-busy", "true");
  try {
    const { body } = await api("/api/invoices");
    if (!authSession?.access_token || sequence !== merchantLoadSequence) return;
    renderInvoiceList(body.invoices);
  } catch (error) {
    if (!authSession?.access_token || sequence !== merchantLoadSequence) return;
    console.error("Merchant invoices could not be loaded:", error);
    list.replaceChildren();
    const message = document.createElement("div");
    message.className = "audit-empty";
    message.textContent = `Invoices could not be loaded: ${error.message}`;
    list.append(message, actionButton("Retry", "button button-quiet", () => void loadMerchantInvoices()));
  } finally {
    if (sequence === merchantLoadSequence) {
      list.removeAttribute("aria-busy");
      refreshButton.removeAttribute("aria-busy");
      refreshButton.disabled = !authSession?.access_token ||
        byId("merchant-wallet-connect").dataset.walletVerified !== "true";
    }
  }
}

async function loadMerchantX402Resources(workspaceSequence) {
  const sequence = workspaceSequence ?? merchantLoadSequence;
  if (!authSession?.access_token) return;
  const list = byId("merchant-x402-resources");
  list.setAttribute("aria-busy", "true");
  if (!list.children.length) list.textContent = "Loading API integrations…";
  try {
    const { body } = await api("/api/merchant/x402/resources");
    if (!authSession?.access_token || sequence !== merchantLoadSequence) return;
    renderMerchantX402Resources(body.resources);
  } finally {
    if (sequence === merchantLoadSequence) list.removeAttribute("aria-busy");
  }
}

function renderMerchantX402LoadError(error) {
  const list = byId("merchant-x402-resources");
  list.replaceChildren();
  const message = document.createElement("div");
  message.className = "audit-empty";
  message.textContent = `API integrations could not be loaded: ${error?.message ?? String(error)}`;
  list.append(message, actionButton(
    "Retry",
    "button button-quiet",
    () => void loadMerchantX402Resources().catch(renderMerchantX402LoadError)
  ));
}

async function refreshMerchantX402Resources() {
  try {
    await loadMerchantX402Resources();
  } catch (error) {
    renderMerchantX402LoadError(error);
  }
}

function renderMerchantX402Resources(resources) {
  const list = byId("merchant-x402-resources");
  list.replaceChildren();
  if (!resources.length) {
    const empty = document.createElement("div");
    empty.className = "audit-empty";
    empty.textContent = "No API resources yet. Add a route above to start accepting exact MUSD payments in your own product.";
    list.append(empty);
    return;
  }
  for (const resource of resources) {
    const card = document.createElement("article");
    card.className = "merchant-x402-resource";
    const copy = document.createElement("div");
    copy.className = "merchant-x402-resource-copy";
    const title = document.createElement("strong");
    title.textContent = resource.name;
    const details = document.createElement("small");
    details.textContent = `${resource.method} ${resource.routePath} · $${resource.price.slice(1)} MUSD`;
    copy.append(title, details);
    const status = document.createElement("span");
    status.className = `status-pill ${resource.keyPrefix && !resource.keyRevokedAt ? "success" : "pending"}`;
    status.textContent = resource.keyPrefix && !resource.keyRevokedAt ? "KEY ACTIVE" : "KEY REVOKED";
    const actions = document.createElement("div");
    actions.className = "merchant-x402-resource-actions";
    actions.append(actionButton(
      resource.keyPrefix && !resource.keyRevokedAt ? "Rotate key" : "Create key",
      "button button-quiet",
      () => void rotateMerchantX402Key(resource.id)
    ));
    if (resource.keyPrefix && !resource.keyRevokedAt) {
      actions.append(actionButton("Revoke", "button button-quiet", () => void revokeMerchantX402Key(resource.id)));
    }
    actions.append(actionButton("Delete", "button button-quiet", () => void deleteMerchantX402Resource(resource.id)));
    card.append(copy, status, actions);
    list.append(card);
  }
}

async function verifyMerchantWallet() {
  const button = byId("merchant-wallet-connect");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Connecting wallet…";
  try {
    const wallet = await requestWalletProvider();
    const provider = wallet.provider;
    button.textContent = `Connecting ${wallet.name}…`;
    await ensureMezoWallet(provider);
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error("The wallet did not return a valid EVM account.");
    }
    button.textContent = "Requesting signature…";
    byId("merchant-wallet-state").textContent = `Requesting a one-time ownership signature for ${shortAddress(address)}…`;
    const { body: challenge } = await api("/api/merchant/wallet/challenge", {
      method: "POST",
      body: JSON.stringify({ address })
    });
    button.textContent = "Verifying wallet…";
    const signature = await provider.request({
      method: "personal_sign",
      params: [challenge.message, challenge.address]
    });
    if (typeof signature !== "string") throw new Error("Wallet did not return a signature.");
    await api("/api/merchant/wallet/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: challenge.challengeId, signature })
    });
    toast("Receiving wallet verified. Invoice funds settle directly to this address.", "success");
    await loadMerchantWorkspace();
  } catch (error) {
    byId("merchant-wallet-state").textContent = error.message;
    toast(error.message, "error");
  } finally {
    button.disabled = !authSession?.access_token;
    button.removeAttribute("aria-busy");
    button.textContent = byId("merchant-wallet-connect").dataset.walletVerified === "true"
      ? "Change wallet"
      : "Connect & verify";
  }
}

function showX402ApiKey(apiKey, warning) {
  const target = byId("x402-resource-credential");
  target.replaceChildren();
  target.classList.remove("hidden");
  const heading = document.createElement("strong");
  heading.textContent = warning;
  const keyLine = document.createElement("div");
  keyLine.className = "x402-api-key";
  const key = document.createElement("code");
  key.textContent = apiKey;
  const copy = actionButton("Copy key", "button button-quiet", async () => {
    await navigator.clipboard.writeText(apiKey);
    toast("Merchant API key copied.", "success");
  });
  keyLine.append(key, copy);
  const snippet = document.createElement("pre");
  snippet.textContent = [
    "import { createRelayGuardX402Middleware } from \"./relayguard-express.js\";",
    "",
    "app.use(await createRelayGuardX402Middleware({",
    "  apiKey: process.env.RELAYGUARD_API_KEY",
    "}));"
  ].join("\n");
  const guide = document.createElement("a");
  guide.href = "https://github.com/Reinasboo/relayguard/blob/main/docs/integrations/express-x402.md";
  guide.target = "_blank";
  guide.rel = "noreferrer noopener";
  guide.textContent = "Open integration guide ↗";
  target.append(heading, keyLine, snippet, guide);
}

async function createMerchantX402Resource(event) {
  event.preventDefault();
  const button = byId("x402-resource-button");
  button.disabled = true;
  try {
    const { body } = await api("/api/merchant/x402/resources", {
      method: "POST",
      body: JSON.stringify({
        name: byId("x402-resource-name").value.trim(),
        routePath: byId("x402-resource-path").value.trim(),
        method: byId("x402-resource-method").value,
        price: `$${byId("x402-resource-price").value.trim()}`,
        description: byId("x402-resource-description").value.trim()
      })
    });
    showX402ApiKey(body.apiKey, body.keyWarning);
    await refreshMerchantX402Resources();
    toast("x402 endpoint configured for your verified wallet.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = !authSession?.access_token ||
      byId("merchant-wallet-connect").dataset.walletVerified !== "true";
  }
}

async function rotateMerchantX402Key(resourceId) {
  if (!window.confirm("Rotate this API key? The current key will stop working immediately.")) return;
  try {
    const { body } = await api(`/api/merchant/x402/resources/${encodeURIComponent(resourceId)}/key`, {
      method: "POST"
    });
    showX402ApiKey(body.apiKey, body.keyWarning);
    await refreshMerchantX402Resources();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function revokeMerchantX402Key(resourceId) {
  if (!window.confirm("Revoke this API key? Your product will stop issuing payment challenges until you create a new key.")) return;
  try {
    await api(`/api/merchant/x402/resources/${encodeURIComponent(resourceId)}/key`, { method: "DELETE" });
    await refreshMerchantX402Resources();
    toast("Merchant API key revoked.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteMerchantX402Resource(resourceId) {
  if (!window.confirm("Delete this x402 resource and its key? Its protected endpoint will stop accepting payments.")) return;
  try {
    await api(`/api/merchant/x402/resources/${encodeURIComponent(resourceId)}`, { method: "DELETE" });
    await refreshMerchantX402Resources();
    toast("x402 resource and credential deleted.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderMerchantSetup(signedIn, walletVerified, hasInvoice) {
  const states = [signedIn ? "done" : "current", walletVerified ? "done" : signedIn ? "current" : "waiting",
    hasInvoice && walletVerified ? "done" : walletVerified ? "current" : "waiting"];
  ["account", "wallet", "invoice"].forEach((step, index) => {
    const element = byId(`setup-${step}`);
    element.dataset.state = states[index];
    element.querySelector("b").textContent = states[index] === "done" ? "COMPLETE" : states[index] === "current" ? "YOUR NEXT STEP" : "UP NEXT";
    if (states[index] === "current") element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  });
}

function renderAuthState(message) {
  const target = byId("auth-state");
  const signedIn = Boolean(authSession?.access_token);
  if (!signedIn) renderMerchantSetup(false, false, false);
  target.textContent = message ?? (signedIn
    ? "Account connected. Merchant invoice management is active."
    : appConfig?.supabase
      ? "Sign in or create a merchant account to manage invoices."
      : "Merchant account access is temporarily unavailable. Please try again later.");
  target.className = `notice${signedIn && !message ? " auth-connected" : ""}`;
  byId("auth-signout").classList.toggle("hidden", !signedIn);
  byId("auth-signup").classList.toggle("hidden", signedIn || !appConfig?.supabase);
  byId("merchant-auth-form").classList.toggle("hidden", signedIn || !appConfig?.supabase);
  if (!signedIn) {
    byId("x402-resource-credential").replaceChildren();
    byId("x402-resource-credential").classList.add("hidden");
    byId("merchant-wallet-connect").disabled = true;
    byId("merchant-wallet-connect").dataset.walletVerified = "false";
    byId("merchant-name-save").disabled = true;
    byId("x402-resource-button").disabled = true;
    byId("refresh-invoices").disabled = true;
    merchantInvoices = [];
    byId("invoice-list").textContent = "Sign in with Supabase to view your merchant invoices.";
    byId("merchant-x402-resources").textContent = "Sign in and verify your wallet to set up product integrations.";
  }
}

async function loadAppConfig() {
  const signInButton = byId("merchant-auth-form").querySelector('button[type="submit"]');
  const signupButton = byId("auth-signup");
  signInButton.disabled = true;
  signupButton.disabled = true;
  signInButton.textContent = "Loading…";
  signupButton.textContent = "Loading…";
  try {
    appConfig = (await api("/api/config")).body;
    renderAuthState();
    if (!appConfig.supabase && authSession) {
      authSession = undefined;
      localStorage.removeItem("relayguard.authSession");
      renderAuthState();
    }
    byId("x402-endpoint").textContent = new URL(appConfig.x402.endpoint, window.location.origin).pathname;
    byId("x402-price").textContent = appConfig.x402.enabled
      ? `${appConfig.x402.price} MUSD · Mezo Testnet`
      : "x402 disabled";
    byId("pay-x402-resource").disabled = !appConfig.x402.enabled;
    if (!appConfig.x402.enabled) {
      byId("x402-result").textContent = "Paid API access is not available on this deployment yet. You can still explore the payment evidence and policy preview.";
      byId("x402-result").classList.remove("hidden");
    }
    signInButton.textContent = "Sign in";
    signupButton.textContent = "Create account";
    signInButton.disabled = !appConfig.supabase;
    signupButton.disabled = !appConfig.supabase;
  } catch (error) {
    console.error("Application configuration could not be loaded:", error);
    renderAuthState("Merchant services are temporarily unavailable. Please refresh and try again.");
    const retry = actionButton("Retry settings", "button button-quiet", () => {
      appConfigPromise = undefined;
      void ensureAppConfig();
    });
    byId("auth-state").append(document.createTextNode(" "), retry);
    byId("pay-x402-resource").disabled = true;
    byId("x402-price").textContent = "Configuration unavailable";
    signInButton.textContent = "Sign in";
    signupButton.textContent = "Create account";
    signInButton.disabled = true;
    signupButton.disabled = true;
  }
}

async function submitMerchantAuth(event) {
  event.preventDefault();
  if (!appConfig?.supabase) {
    renderAuthState("Merchant services are still loading or unavailable. Please wait and try again.");
    return;
  }
  const submitButton = byId("merchant-auth-form").querySelector('button[type="submit"]');
  const signupButton = byId("auth-signup");
  const email = byId("auth-email").value.trim();
  const password = byId("auth-password").value;
  const isSignup = event.submitter?.id === "auth-signup";
  const originalSubmitLabel = submitButton.textContent;
  const originalSignupLabel = signupButton.textContent;
  const endpoint = isSignup
    ? `${appConfig.supabase.url}/auth/v1/signup`
    : `${appConfig.supabase.url}/auth/v1/token?grant_type=password`;
  submitButton.disabled = true;
  signupButton.disabled = true;
  if (isSignup) signupButton.textContent = "Creating account…";
  else submitButton.textContent = "Signing in…";
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: appConfig.supabase.publishableKey
      },
      body: JSON.stringify({
        email,
        password,
        ...(isSignup ? { options: { emailRedirectTo: appConfig.supabase.redirectUrl } } : {})
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || "Supabase authentication failed.");
    if (body.access_token) {
      persistAuthSession(body);
      byId("auth-email").value = "";
      byId("auth-password").value = "";
      renderAuthState();
      await Promise.all([
        loadHealth(),
        loadMerchantWorkspace(),
        loadAudit()
      ]);
      toast("Merchant account connected.", "success");
    } else {
      renderAuthState("Account created. Check your email to verify it, then sign in.");
    }
  } catch (error) {
    renderAuthState(error.message);
  } finally {
    submitButton.disabled = false;
    signupButton.disabled = false;
    submitButton.textContent = originalSubmitLabel;
    signupButton.textContent = originalSignupLabel;
  }
}

async function signOutMerchant() {
  const previousSession = authSession;
  authSession = undefined;
  operatorAccess = false;
  localStorage.removeItem("relayguard.authSession");
  renderAuthState();
  if (previousSession?.access_token && appConfig?.supabase) {
    void fetchWithTimeout(`${appConfig.supabase.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${previousSession.access_token}`,
        apikey: appConfig.supabase.publishableKey
      }
    }).catch((error) => console.warn("Supabase sign-out request failed:", error));
  }
  await Promise.all([loadHealth(), loadMerchantWorkspace(), loadAudit()]);
}

function renderInvoiceList(invoices) {
  const list = byId("invoice-list");
  merchantInvoices = invoices;
  renderMerchantSetup(Boolean(authSession?.access_token), byId("merchant-wallet-connect").dataset.walletVerified === "true", invoices.length > 0);
  list.innerHTML = "";
  if (!invoices.length) {
    const empty = document.createElement("div");
    empty.className = "audit-empty";
    empty.textContent = "No invoices yet. Create a MUSD link to start accepting Mezo payments.";
    list.append(empty);
    return;
  }
  for (const invoice of invoices) {
    const item = document.createElement("div");
    item.className = "invoice-list-item";
    const copy = document.createElement("div");
    copy.className = "invoice-list-copy";
    const title = document.createElement("strong");
    title.textContent = invoice.description;
    const sub = document.createElement("small");
    sub.textContent = `${formatAtomic(invoice.amountAtomic)} MUSD · ${new Date(invoice.createdAt).toLocaleString()}`;
    copy.append(title, sub);
    const status = document.createElement("span");
    status.className = `status-pill ${invoice.status === "paid" ? "success" : invoice.status === "expired" || invoice.status === "failed" ? "danger" : "pending"}`;
    status.textContent = invoice.status.toUpperCase();
    const open = actionButton("Open", "button button-quiet", () => {
      window.location.href = `/pay/${encodeURIComponent(invoice.id)}`;
    });
    item.append(copy, status, open);
    list.append(item);
  }
}

async function createInvoice(event) {
  event.preventDefault();
  const button = byId("invoice-button");
  const label = button.querySelector("span");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (label) label.textContent = "Creating…";
  try {
    const { body } = await api("/api/invoices", {
      method: "POST",
      body: JSON.stringify({
        amount: byId("invoice-amount").value.trim(),
        description: byId("invoice-description").value.trim(),
        expiresInHours: Number(byId("invoice-expiry").value)
      })
    });
    const display = byId("created-invoice");
    display.innerHTML = "";
    display.classList.remove("hidden");
    const qr = document.createElement("img");
    qr.alt = "QR code for the newly created MUSD invoice";
    qr.loading = "eager";
    const qrStatus = document.createElement("small");
    qrStatus.textContent = "Loading QR…";
    qr.addEventListener("load", () => qrStatus.remove(), { once: true });
    qr.addEventListener("error", () => {
      qr.remove();
      qrStatus.textContent = "QR image unavailable. Open the checkout link below.";
      qrStatus.classList.add("danger");
    }, { once: true });
    const details = document.createElement("div");
    details.className = "created-invoice-details";
    const heading = document.createElement("strong");
    heading.textContent = `${formatAtomic(body.invoice.amountAtomic)} MUSD · ${body.invoice.description}`;
    const link = document.createElement("a");
    link.href = body.checkoutUrl;
    link.textContent = body.checkoutUrl;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    const copy = actionButton("Copy checkout link", "button button-quiet", async () => {
      await navigator.clipboard.writeText(body.checkoutUrl);
      toast("Checkout link copied.", "success");
    });
    details.append(heading, link, copy);
    display.append(qr, qrStatus, details);
    qr.src = body.qrUrl;
    renderInvoiceList([
      body.invoice,
      ...merchantInvoices.filter((item) => item.id !== body.invoice.id)
    ]);
    toast("MUSD checkout invoice created.", "success");
    void loadMerchantInvoices();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (label) label.textContent = "Create invoice";
  }
}

async function loadCheckoutPage() {
  setView("checkout");
  byId("checkout-content").classList.add("hidden");
  byId("checkout-loading").classList.remove("hidden");
  byId("checkout-loading").replaceChildren();
  const loadingTitle = document.createElement("strong");
  byId("checkout-state-tag").textContent = "LOADING INVOICE";
  loadingTitle.textContent = "Loading invoice";
  const loadingMessage = document.createElement("span");
  loadingMessage.textContent = "Retrieving invoice and merchant details.";
  byId("checkout-loading").setAttribute("aria-busy", "true");
  byId("checkout-loading").append(loadingTitle, loadingMessage);
  const invoiceId = decodeURIComponent(window.location.pathname.slice("/pay/".length));
  try {
    const [{ body: invoiceBody }, { body: merchantBody }] = await Promise.all([
      api(`/api/invoices/${encodeURIComponent(invoiceId)}`),
      api("/api/merchant")
    ]);
    checkoutInvoice = invoiceBody.invoice;
    let broadcastAttempt;
    try { broadcastAttempt = JSON.parse(sessionStorage.getItem(`relayguard.broadcast:${invoiceId}`) || "null"); } catch { /* no saved attempt */ }
    if (broadcastAttempt && /^0x[0-9a-fA-F]{64}$/.test(broadcastAttempt.transactionHash) &&
        !["paid", "failed", "submitted"].includes(checkoutInvoice.status)) {
      try {
        const recovered = await api(`/api/invoices/${encodeURIComponent(invoiceId)}/submit`, {
          method: "POST", body: JSON.stringify(broadcastAttempt)
        });
        checkoutInvoice = recovered.body.invoice;
      } catch {
        throw new Error(`Your wallet already broadcast ${broadcastAttempt.transactionHash}. The server could not reconcile it yet. Do not pay again; keep this transaction hash and contact the merchant.`);
      }
    }
    byId("checkout-loading").classList.add("hidden");
    byId("checkout-loading").setAttribute("aria-busy", "false");
    byId("checkout-content").classList.remove("hidden");
    byId("checkout-merchant-name").textContent = checkoutInvoice.merchantName;
    byId("checkout-amount").textContent = `${formatAtomic(checkoutInvoice.amountAtomic)} MUSD`;
    byId("checkout-description").textContent = checkoutInvoice.description;
    byId("checkout-merchant-address").textContent = shortAddress(checkoutInvoice.merchantAddress);
    byId("checkout-merchant-address").title = checkoutInvoice.merchantAddress;
    byId("checkout-expiry").textContent = new Date(checkoutInvoice.expiresAt).toLocaleString();
    const qr = byId("checkout-qr");
    const qrHint = qr.parentElement.querySelector("small");
    qr.onerror = () => {
      qr.classList.add("hidden");
      qrHint.textContent = "QR image unavailable. Reload this checkout or use the page URL.";
      qrHint.classList.add("danger");
    };
    qr.onload = () => {
      qr.classList.remove("hidden");
      qrHint.textContent = "Scan with a wallet to open this invoice";
      qrHint.classList.remove("danger");
    };
    qr.src = `/api/invoices/${encodeURIComponent(invoiceId)}/qr`;
    const status = byId("checkout-state-tag");
    status.textContent = checkoutInvoice.status === "paid"
      ? "PAYMENT CONFIRMED"
      : checkoutInvoice.status === "authorized"
        ? "PAYMENT RESERVED"
      : checkoutInvoice.status === "expired"
        ? "INVOICE EXPIRED"
        : checkoutInvoice.status === "failed"
          ? "PAYMENT FAILED"
          : checkoutInvoice.status === "submitted"
            ? "VERIFYING PAYMENT"
            : "AWAITING PAYMENT";
    status.className = `verified-tag checkout-status ${checkoutInvoice.status === "paid" ? "success" : checkoutInvoice.status === "failed" || checkoutInvoice.status === "expired" ? "danger" : ""}`;
    if (checkoutInvoice.status === "authorized") {
      byId("checkout-wallet-state").textContent =
        "This invoice has an unsubmitted payment authorization. Continue with the same wallet that started checkout; the invoice will be released if you reject the wallet request.";
      byId("connect-pay-button").textContent = "Connect wallet & continue";
    } else if (checkoutInvoice.status !== "open") {
      byId("checkout-wallet-state").textContent = checkoutInvoice.status === "paid"
        ? "This invoice has been paid and verified."
        : checkoutInvoice.status === "submitted"
          ? "Payment has been submitted. Settlement is being verified."
          : `This invoice is ${checkoutInvoice.status}.`;
      byId("checkout-wallet-state").className = checkoutInvoice.status === "paid"
        ? "success-message"
        : "notice";
      byId("connect-pay-button").disabled = true;
      byId("connect-pay-button").textContent = checkoutInvoice.status === "paid"
        ? "Payment confirmed"
        : checkoutInvoice.status === "submitted"
          ? "Check payment status"
          : checkoutInvoice.status === "expired"
            ? "Invoice expired"
            : "Payment unavailable";
      if (checkoutInvoice.status !== "authorized") {
        byId("checkout-qr").parentElement.classList.add("hidden");
      }
      if (checkoutInvoice.status === "paid") {
        setCheckoutMessage("Payment confirmed on Mezo.", "success-message");
        byId("checkout-result").classList.remove("hidden");
      }
    }
    byId("connect-pay-button").addEventListener("click", () => {
      if (checkoutInvoice.status === "submitted") {
        void pollCheckoutInvoice();
      } else if (checkoutInvoice.status === "open" || checkoutInvoice.status === "authorized") {
        void payCheckout();
      }
    });
    if (checkoutInvoice.status === "submitted") {
      void pollCheckoutInvoice();
    }
    if (!merchantBody.tokenAddress) {
      byId("connect-pay-button").disabled = true;
      byId("checkout-wallet-state").textContent = "MUSD contract is not configured for this Mezo testnet.";
    }
  } catch (error) {
    byId("checkout-loading").setAttribute("aria-busy", "false");
    byId("checkout-loading").replaceChildren();
    const message = document.createElement("strong");
    message.textContent = "Invoice could not be loaded";
    byId("checkout-state-tag").textContent = "INVOICE UNAVAILABLE";
    byId("checkout-state-tag").className = "verified-tag checkout-status danger";
    const details = document.createElement("span");
    details.textContent = error.message;
    const retry = actionButton("Retry loading invoice", "button button-quiet", () => void loadCheckoutPage());
    byId("checkout-loading").append(message, details, retry);
  }
}

async function ensureMezoWallet(provider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (String(chainId).toLowerCase() === "0x7b7b") return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7b7b" }]
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x7b7b",
        chainName: "Mezo Testnet",
        nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
        rpcUrls: ["https://rpc.test.mezo.org"],
        blockExplorerUrls: ["https://explorer.test.mezo.org"]
      }]
    });
  }
  const switchedChainId = await provider.request({ method: "eth_chainId" });
  if (String(switchedChainId).toLowerCase() !== "0x7b7b") {
    throw new Error("Your wallet is not connected to Mezo Testnet. No transaction was submitted.");
  }
}

function setCheckoutMessage(message, kind = "notice") {
  const target = byId("checkout-result");
  target.className = kind;
  target.textContent = message;
}

function formatBtcAtomic(value, digits = 8) {
  return formatDisplayAtomic(value, digits);
}

function showCheckoutPreflight(preflight) {
  const panel = byId("checkout-preflight");
  panel.replaceChildren();
  for (const line of [
    `Wallet MUSD: ${formatAtomic(preflight.musdBalanceAtomic)} · invoice: ${formatAtomic(preflight.requiredMusdAtomic)}`,
    `Wallet BTC: ${formatBtcAtomic(preflight.nativeBalanceAtomic)} for Mezo gas`
  ]) {
    const item = document.createElement("div");
    item.textContent = line;
    panel.append(item);
  }
  if (preflight.transferGasAtomic) {
    const gas = BigInt(preflight.transferGas) * BigInt(preflight.transferGasAtomic);
    const item = document.createElement("div");
    item.textContent = `Estimated transfer gas: ${formatBtcAtomic(gas, 18)} BTC`;
    panel.append(item);
  }
  panel.classList.remove("hidden");
}

function setBorrowStatus(message, kind = "") {
  const status = byId("checkout-borrow-status");
  status.className = `checkout-borrow-status${kind ? ` ${kind}` : ""}`;
  status.textContent = message;
}

function borrowErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const hash = message.match(/\b0x[a-f0-9]{64}\b/i)?.[0];
  if (error?.code === 4001) {
    return "Wallet confirmation was rejected. No trove was opened and no invoice payment was submitted.";
  }
  if (/was submitted, but confirmation is still pending/i.test(message)) {
    return `Borrow transaction ${hash ?? "was submitted"} but confirmation could not be verified. Check its status in the Mezo Testnet explorer before retrying; do not pay the invoice yet.`;
  }
  if (/borrow transaction .* reverted/i.test(message)) {
    return `Borrow transaction ${hash ?? "reverted"} on Mezo Testnet. No invoice payment was submitted.`;
  }
  if (/trove opening confirmed/i.test(message)) {
    return `Trove opening is confirmed${hash ? ` (${hash})` : ""}, but the MUSD balance could not be refreshed. Check your wallet before continuing to payment.`;
  }
  if (normalized.includes("insufficient balance for transfer") || normalized.includes("insufficient funds")) {
    return "This wallet does not have enough Mezo Testnet BTC for the selected collateral and gas. Add testnet BTC and retry; no transaction was submitted.";
  }
  if (
    normalized.includes("unexpected mocked rpc method") ||
    normalized.includes("eth_estimategas") ||
    normalized.includes("estimate gas arguments")
  ) {
    return "The connected wallet or RPC could not estimate this borrow. Check that it supports Mezo Testnet gas estimation and retry; no transaction was submitted.";
  }
  if (normalized.includes("200% opening buffer") || normalized.includes("no more than 18 decimal places")) {
    return `${message} No transaction was submitted.`;
  }
  if (
    message.length <= 220 &&
    !/request body|estimate gas arguments|version: viem|unknown rpc error/i.test(normalized)
  ) {
    return /no transaction was submitted|no trove was opened|no invoice payment was submitted/i.test(normalized)
      ? message
      : `${message} No transaction was submitted.`;
  }
  return "Could not verify a safe Mezo Testnet borrow quote. Check the network and wallet balance, then retry. No transaction was submitted.";
}

function renderBorrowQuote(quote) {
  const summary = byId("checkout-borrow-review-result");
  summary.replaceChildren();
  const rateBps = BigInt(quote.interestRateBps);
  const annualRate = `${rateBps / 100n}.${(rateBps % 100n).toString().padStart(2, "0")}`;
  const rows = [
    ["Borrowed to wallet", `${formatAtomic(quote.principalAtomic)} MUSD`],
    ["Current borrowing fee", `${formatAtomic(quote.borrowingFeeAtomic)} MUSD`],
    ["Gas compensation added to debt", `${formatAtomic(quote.gasCompensationAtomic)} MUSD`],
    ["Estimated opening debt", `${formatAtomic(quote.compositeDebtAtomic)} MUSD`],
    ["Current fixed simple interest rate", `${annualRate}% per year`],
    ["BTC collateral to lock", `${formatBtcAtomic(quote.collateralAtomic)} BTC`],
    ["Estimated opening collateral ratio", `${formatDisplayAtomic(BigInt(quote.initialIcrAtomic) * 100n, 2)}%`],
    ["Mezo BTC price at block", `$${formatDisplayAtomic(quote.priceAtomic, 2)}`],
    ["Estimated gas cost", `${formatBtcAtomic(quote.estimatedGasCostAtomic, 18)} BTC`],
    ["Quote block", quote.blockNumber],
    ["Network", "Mezo Testnet · chain ID 31611"]
  ];
  for (const [label, value] of rows) {
    const line = document.createElement("div");
    line.append(document.createTextNode(`${label}: `));
    const detail = document.createElement("strong");
    detail.textContent = value;
    line.append(detail);
    summary.append(line);
  }
  const note = document.createElement("p");
  note.textContent = "This creates a trove; it does not pay the invoice. The 200% target is RelayGuard’s conservative UI buffer, not a Mezo parameter. The minimum borrow may exceed the invoice; unused MUSD stays in your wallet. Price and transaction checks can change before confirmation.";
  summary.append(note);
  summary.classList.remove("hidden");
  byId("checkout-borrow-ack").checked = false;
  byId("checkout-borrow-ack-wrap").classList.remove("hidden");
  byId("checkout-borrow-confirm").classList.remove("hidden");
  byId("checkout-borrow-confirm").disabled = true;
  checkoutBorrowQuote = quote;
}

function parseBtcAmount(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a positive BTC amount with no more than 18 decimal places.");
  const atomic = BigInt(match[1]) * 10n ** 18n +
    BigInt((match[2] ?? "").padEnd(18, "0") || "0");
  if (atomic <= 0n) throw new Error("Collateral amount must be greater than zero.");
  return atomic;
}

async function prepareBorrowOption(provider, account, preflight) {
  byId("checkout-borrow-panel").classList.remove("hidden");
  byId("checkout-borrow-form").classList.add("hidden");
  byId("checkout-borrow-review-result").classList.add("hidden");
  byId("checkout-borrow-ack-wrap").classList.add("hidden");
  byId("checkout-borrow-confirm").classList.add("hidden");
  checkoutBorrowQuote = undefined;
  setBorrowStatus("Checking current Mezo Testnet trove and BorrowerOperations terms…");
  try {
    const terms = await getMezoTroveOpeningTerms(provider, account);
    if (terms.troveStatus === "active") {
      setBorrowStatus("This wallet already has an active trove. Opening another one is not allowed. Manage or adjust the existing position in Mezo’s official app; adding collateral alone does not provide MUSD for this invoice.");
      return;
    }
    const shortfall = BigInt(preflight.requiredMusdAtomic) - BigInt(preflight.musdBalanceAtomic);
    if (BigInt(terms.principalAtomic) < shortfall) {
      setBorrowStatus(
        `This deployment’s minimum borrow of ${formatAtomic(terms.principalAtomic)} MUSD would not cover the ${formatAtomic(shortfall)} MUSD shortfall. No trove-opening option is offered; use another MUSD source or ask the merchant about the invoice amount.`
      );
      return;
    }
    byId("checkout-borrow-form").classList.remove("hidden");
    byId("checkout-borrow-collateral").value = terms.minimumCollateral;
    byId("checkout-borrow-minimum").textContent =
      `Current estimate: at least ${formatBtcAtomic(terms.minimumCollateralAtomic)} BTC to meet RelayGuard’s 200% opening buffer. PriceFeed block ${terms.blockNumber}; price and fees can change.`;
    setBorrowStatus(
      `This deployment requires at least ${formatAtomic(terms.principalAtomic)} MUSD borrowed. The live fee, fixed interest rate, collateral ratio, and gas estimate will be shown before wallet confirmation.`
    );
  } catch (error) {
    console.error("Mezo Testnet borrow terms could not be verified:", error);
    setBorrowStatus(borrowErrorMessage(error), "error");
  }
}

async function reviewTroveOpen() {
  const provider = checkoutProvider;
  if (!provider || !checkoutWallet) {
    setBorrowStatus("Reconnect your EVM wallet and retry the quote.", "error");
    return;
  }
  const button = byId("checkout-borrow-review");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Checking terms & gas…";
  byId("checkout-borrow-review-result").classList.add("hidden");
  byId("checkout-borrow-ack-wrap").classList.add("hidden");
  byId("checkout-borrow-confirm").classList.add("hidden");
  try {
    const quote = await quoteMezoTroveOpen(
      provider,
      checkoutWallet,
      parseBtcAmount(byId("checkout-borrow-collateral").value)
    );
    renderBorrowQuote(quote);
    setBorrowStatus("Review every amount and risk note below. The wallet transaction is a separate confirmation; invoice payment is never automatic.");
  } catch (error) {
    checkoutBorrowQuote = undefined;
    console.error("Mezo Testnet borrow quote could not be estimated:", error);
    setBorrowStatus(borrowErrorMessage(error), "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Review testnet trove";
  }
}

async function confirmTroveOpen() {
  const provider = checkoutProvider;
  const quote = checkoutBorrowQuote;
  if (!provider || !checkoutWallet || !quote || !byId("checkout-borrow-ack").checked) return;
  const button = byId("checkout-borrow-confirm");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Rechecking quote…";
  byId("checkout-borrow-review").disabled = true;
  try {
    const result = await openMezoTestnetTrove(
      provider,
      checkoutWallet,
      quote,
      checkoutInvoice.amountAtomic,
      (message) => {
        setBorrowStatus(message);
        button.textContent = message.includes("submitted")
          ? "Waiting for Mezo…"
          : "Confirm in wallet…";
      }
    );
    const balance = BigInt(result.musdBalanceAtomic);
    const required = BigInt(checkoutInvoice.amountAtomic);
    setBorrowStatus(
      `Trove confirmed. Wallet now has ${formatAtomic(result.musdBalanceAtomic)} MUSD; this invoice requires ${formatAtomic(checkoutInvoice.amountAtomic)} MUSD. The invoice is still unpaid. Continue only by separately selecting the payment button.`,
      "success"
    );
    const link = document.createElement("a");
    link.href = `https://explorer.test.mezo.org/tx/${result.hash}`;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = `View confirmed borrow transaction ${shortAddress(result.hash)}`;
    byId("checkout-borrow-status").append(document.createElement("br"), link);
    byId("connect-pay-button").textContent = balance >= required
      ? "Check balance & continue to payment"
      : "Check balance again";
    byId("connect-pay-button").disabled = false;
    byId("checkout-borrow-form").classList.add("hidden");
    byId("checkout-borrow-ack-wrap").classList.add("hidden");
    button.classList.add("hidden");
  } catch (error) {
    console.error("Mezo Testnet trove opening needs follow-up:", error);
    setBorrowStatus(borrowErrorMessage(error), "error");
    button.disabled = false;
    byId("checkout-borrow-review").disabled = false;
    button.textContent = "Confirm & open trove in wallet";
  } finally {
    button.removeAttribute("aria-busy");
  }
}

function markCheckoutPaid(transactionHash) {
  try { sessionStorage.removeItem(`relayguard.broadcast:${checkoutInvoice.id}`); } catch { /* storage may be unavailable */ }
  const status = byId("checkout-state-tag");
  status.textContent = "PAYMENT CONFIRMED";
  status.className = "verified-tag checkout-status success";
  byId("checkout-wallet-state").textContent = "Payment confirmed by Mezo Testnet.";
  byId("checkout-wallet-state").className = "success-message";
  byId("connect-pay-button").textContent = "Payment confirmed";
  byId("connect-pay-button").disabled = true;
  setCheckoutMessage(`MUSD payment settled. Transaction: ${transactionHash}`, "success-message");
  byId("checkout-result").classList.remove("hidden");
}

async function pollCheckoutInvoice() {
  if (checkoutVerificationInProgress || checkoutInvoice?.status !== "submitted") return;
  checkoutVerificationInProgress = true;
  const button = byId("connect-pay-button");
  button.disabled = true;
  button.textContent = "Verifying payment…";
  button.setAttribute("aria-busy", "true");
  const transactionHash = checkoutInvoice.transactionReference;
  let attempt = 0;
  try {
    while (checkoutInvoice.status === "submitted" && attempt < 20) {
      try {
        const verified = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/verify`, { method: "POST" });
        checkoutInvoice = verified.body.invoice;
        if (checkoutInvoice.status === "paid") {
          markCheckoutPaid(transactionHash);
          return;
        }
        if (checkoutInvoice.status === "failed") {
          const status = byId("checkout-state-tag");
          status.textContent = "PAYMENT FAILED";
          status.className = "verified-tag checkout-status danger";
          byId("checkout-wallet-state").textContent = "Mezo could not verify the exact MUSD transfer for this invoice.";
          byId("checkout-wallet-state").className = "danger";
          button.textContent = "Payment failed";
          button.disabled = true;
          setCheckoutMessage("Payment verification failed. Contact the merchant before attempting another payment.", "error");
          byId("checkout-result").classList.remove("hidden");
          return;
        }
        byId("checkout-wallet-state").textContent = `Payment submitted. Waiting for Mezo confirmation (${attempt + 1}/20)…`;
      } catch (error) {
        if (error.status && error.status < 500 && error.status !== 429) {
          byId("checkout-wallet-state").textContent = `Could not verify this invoice (HTTP ${error.status}): ${error.message}`;
          setCheckoutMessage("The transaction was submitted. Do not pay again; contact the merchant if this persists.", "error");
          byId("checkout-result").classList.remove("hidden");
          return;
        }
        byId("checkout-wallet-state").textContent = `Verification temporarily unavailable; retrying automatically. Do not pay again. ${error.message}`;
      }
      attempt += 1;
      if (checkoutInvoice.status === "submitted" && attempt < 20) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 5 ? 750 : 2500));
      }
    }
    if (checkoutInvoice.status === "submitted" && attempt >= 20) {
      byId("checkout-wallet-state").textContent = "Payment is still submitted. Automatic checks have stopped; check status again shortly. Do not pay again.";
      byId("checkout-wallet-state").className = "notice";
      setCheckoutMessage("No final Mezo receipt was available after 20 checks. The transaction may still settle; use “Check payment status” to retry and do not send another payment.", "notice");
      byId("checkout-result").classList.remove("hidden");
    }
  } finally {
    checkoutVerificationInProgress = false;
    button.removeAttribute("aria-busy");
    if (checkoutInvoice?.status === "submitted") {
      button.disabled = false;
      button.textContent = "Check payment status";
    }
  }
}

async function payCheckout() {
  const button = byId("connect-pay-button");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Connecting wallet…";
  checkoutAuthorization = undefined;
  let broadcastHash;
  try {
    const wallet = await requestWalletProvider();
    const provider = wallet.provider;
    checkoutProvider = provider;
    button.textContent = `Connecting ${wallet.name}…`;
    await ensureMezoWallet(provider);
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    checkoutWallet = accounts[0];
    if (!checkoutWallet) throw new Error("Wallet did not return an account.");
    button.textContent = "Checking MUSD & BTC…";
    const token = await api("/api/merchant");
    if (typeof token.body.tokenAddress !== "string" ||
        token.body.tokenAddress.toLowerCase() !== MEZO_TESTNET_MUSD.toLowerCase()) {
      throw new Error("Checkout MUSD contract does not match the verified Mezo Testnet token. No transaction was submitted.");
    }
    const preflight = await inspectMezoCheckoutWallet(
      provider,
      checkoutWallet,
      checkoutInvoice.merchantAddress,
      checkoutInvoice.amountAtomic
    );
    showCheckoutPreflight(preflight);
    if (!preflight.sufficientMusd) {
      const shortfall = BigInt(preflight.requiredMusdAtomic) - BigInt(preflight.musdBalanceAtomic);
      byId("checkout-wallet-state").textContent =
        `Connected ${shortAddress(checkoutWallet)}. You are short ${formatAtomic(shortfall)} MUSD. No payment authorization or transaction was created.`;
      await prepareBorrowOption(provider, checkoutWallet, preflight);
      return;
    }
    byId("checkout-borrow-panel").classList.add("hidden");
    if (!preflight.sufficientGas) {
      const gas = BigInt(preflight.transferGas) * BigInt(preflight.transferGasAtomic);
      byId("checkout-wallet-state").textContent =
        `Your MUSD balance covers the invoice, but your BTC balance is below the estimated transfer gas cost (${formatBtcAtomic(gas, 18)} BTC). Add testnet BTC and retry; no payment authorization was created.`;
      return;
    }
    byId("checkout-wallet-state").textContent = `Connected ${shortAddress(checkoutWallet)} · MUSD balance and estimated BTC gas checked. Requesting exact payment authorization…`;
    button.textContent = "Requesting authorization…";
    button.textContent = "Verify wallet ownership…";
    const { body: proof } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/challenge`, {
      method: "POST", body: JSON.stringify({ payerAddress: checkoutWallet })
    });
    const signature = await provider.request({ method: "personal_sign", params: [
      `0x${Array.from(new TextEncoder().encode(proof.message), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      checkoutWallet
    ] });
    const { body: authorizedBody } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/authorize`, {
      method: "POST",
      body: JSON.stringify({ payerAddress: checkoutWallet, challenge: proof.challenge, signature })
    });
    checkoutInvoice = authorizedBody.invoice;
    checkoutAuthorization = authorizedBody.authorization;
    checkoutToken = authorizedBody.checkoutToken;
    const amountHex = BigInt(checkoutInvoice.amountAtomic).toString(16).padStart(64, "0");
    const addressHex = checkoutInvoice.merchantAddress.slice(2).toLowerCase().padStart(64, "0");
    const data = `0xa9059cbb${addressHex}${amountHex}`;
    button.textContent = "Confirm in wallet…";
    byId("checkout-wallet-state").textContent = "Review the exact MUSD transfer in your wallet and confirm to submit it to Mezo Testnet.";
    const transactionHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: checkoutWallet,
        to: token.body.tokenAddress,
        value: "0x0",
        data
      }]
    });
    broadcastHash = transactionHash;
    try {
      sessionStorage.setItem(`relayguard.broadcast:${checkoutInvoice.id}`, JSON.stringify({
        authorizationId: checkoutAuthorization.id, checkoutToken, transactionHash
      }));
    } catch { /* Record on the server immediately even if browser storage is unavailable. */ }
    const { body: submittedBody } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/submit`, {
      method: "POST",
      body: JSON.stringify({
        authorizationId: checkoutAuthorization.id,
        checkoutToken,
        transactionHash
      })
    });
    checkoutInvoice = submittedBody.invoice;
    button.textContent = "Submitted · verifying…";
    byId("checkout-wallet-state").textContent = `Submitted ${shortAddress(transactionHash)}. Waiting for the chain receipt…`;
    await pollCheckoutInvoice();
    return;
  } catch (error) {
    if (broadcastHash && checkoutAuthorization) {
      try {
        const { body: current } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}`);
        checkoutInvoice = current.invoice;
        if (checkoutInvoice.status === "authorized") {
          const submitted = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/submit`, {
            method: "POST",
            body: JSON.stringify({
              authorizationId: checkoutAuthorization.id,
              checkoutToken,
              transactionHash: broadcastHash
            })
          });
          checkoutInvoice = submitted.body.invoice;
        }
        if (checkoutInvoice.status === "submitted") {
          setCheckoutMessage(`Your wallet broadcast the payment. Keep this page open and verify the receipt. Hash: ${broadcastHash}`, "notice");
          byId("checkout-result").classList.remove("hidden");
          button.textContent = "Payment submitted";
          return;
        }
      } catch (reconcileError) {
        console.error("Could not reconcile broadcast checkout transaction:", reconcileError);
        setCheckoutMessage(`A transaction was broadcast, but the server could not record it yet. Do not pay again. Hash: ${broadcastHash}`, "notice");
        byId("checkout-result").classList.remove("hidden");
        button.textContent = "Transaction broadcast";
        return;
      }
    }
    if (!broadcastHash && checkoutAuthorization && checkoutWallet && checkoutInvoice?.status === "authorized") {
      try {
        await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/release`, {
          method: "POST",
          body: JSON.stringify({
            authorizationId: checkoutAuthorization.id,
            checkoutToken,
            payerAddress: checkoutWallet
          })
        });
        checkoutInvoice.status = "open";
        checkoutAuthorization = undefined;
      } catch (releaseError) {
        console.error("Could not release unsubmitted invoice:", releaseError);
      }
    }
    const message = error.code === 4001
      ? "Wallet request was rejected. The invoice remains unpaid."
      : error.code === "insufficient_musd"
        ? `Your wallet has ${formatAtomic(error.details.balanceAtomic)} MUSD; this invoice requires ${formatAtomic(error.details.requiredAtomic)} MUSD.`
        : error.message;
    byId("checkout-wallet-state").textContent = message;
    setCheckoutMessage(message, "notice");
    byId("checkout-result").classList.remove("hidden");
  } finally {
    button.removeAttribute("aria-busy");
    const canContinue = ["open", "authorized"].includes(checkoutInvoice?.status);
    button.disabled = !canContinue;
    if (canContinue) {
      button.textContent = checkoutInvoice.status === "authorized"
        ? "Connect wallet & continue"
        : "Connect wallet & pay with MUSD";
    }
  }
}

document.querySelectorAll("[data-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const view = link.dataset.view;
    if (!["console", "merchant", "faq"].includes(view)) return;
    history.pushState(null, "", `/#${view}`);
    setView(view);
    if (view === "console") {
      void ensureAppConfig();
      void loadHealth();
      void loadAudit();
    } else if (view === "merchant") {
      void ensureAppConfig();
      void loadMerchantWorkspace();
    }
  });
});
function syncWorkspaceLocation() {
  if (window.location.pathname.startsWith("/pay/")) return;
  const view = ["#merchant", "#faq", "#console"].includes(location.hash) ? location.hash.slice(1) : "merchant";
  setView(view);
  if (view === "console") { void ensureAppConfig(); void loadHealth(); void loadAudit(); }
  if (view === "merchant") { void ensureAppConfig(); void loadMerchantWorkspace(); }
}
window.addEventListener("popstate", syncWorkspaceLocation);
window.addEventListener("hashchange", syncWorkspaceLocation);
const faqSearch = byId("faq-search");
const faqFilters = [...document.querySelectorAll("[data-faq-filter]")];
const faqItems = [...document.querySelectorAll(".faq-item")];
function updateFaqResults() {
  const query = faqSearch.value.trim().toLocaleLowerCase();
  const category = document.querySelector(".faq-filter.active")?.dataset.faqFilter ?? "all";
  let visible = 0;
  for (const item of faqItems) {
    const matchesCategory = category === "all" || item.dataset.faqCategory === category;
    const matchesSearch = !query || item.textContent.toLocaleLowerCase().includes(query);
    const show = matchesCategory && matchesSearch;
    item.classList.toggle("hidden", !show);
    if (show) visible += 1;
  }
  byId("faq-result-count").textContent = `${visible} ${visible === 1 ? "answer" : "answers"}`;
  byId("faq-no-results").classList.toggle("hidden", visible !== 0);
}
faqSearch.addEventListener("input", updateFaqResults);
faqFilters.forEach((filter) => {
  filter.addEventListener("click", () => {
    faqFilters.forEach((item) => item.classList.toggle("active", item === filter));
    updateFaqResults();
  });
});
byId("faq-clear-search").addEventListener("click", () => {
  faqSearch.value = "";
  faqFilters.forEach((item) => item.classList.toggle("active", item.dataset.faqFilter === "all"));
  updateFaqResults();
  faqSearch.focus();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditing = target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  if (event.key === "/" && !isEditing && !byId("faq-view").classList.contains("hidden")) {
    event.preventDefault();
    faqSearch.focus();
  } else if (event.key === "Escape" && target === faqSearch) {
    faqSearch.value = "";
    updateFaqResults();
    faqSearch.blur();
  }
});
byId("invoice-form").addEventListener("submit", createInvoice);
byId("asset").addEventListener("change", updateUnit);
byId("refresh-invoices").addEventListener("click", () => void loadMerchantInvoices());
byId("merchant-wallet-connect").addEventListener("click", () => void verifyMerchantWallet());
byId("merchant-name-save").addEventListener("click", () => void saveMerchantName());
byId("merchant-x402-form").addEventListener("submit", createMerchantX402Resource);
byId("merchant-auth-form").addEventListener("submit", submitMerchantAuth);
byId("auth-signup").addEventListener("click", (event) => {
  const formEvent = new Event("submit", { bubbles: true, cancelable: true });
  Object.defineProperty(formEvent, "submitter", { value: event.currentTarget });
  byId("merchant-auth-form").dispatchEvent(formEvent);
});
byId("auth-signout").addEventListener("click", signOutMerchant);
byId("copy-x402-endpoint").addEventListener("click", async () => {
  const endpoint = new URL(appConfig.x402.endpoint, window.location.origin).toString();
  await navigator.clipboard.writeText(endpoint);
  toast("API endpoint copied.", "success");
});
byId("pay-x402-resource").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  byId("x402-result").classList.add("hidden");
  try {
    const wallet = await requestWalletProvider();
    const { body, settlement } = await payForRelayguardResource(
      "/api/paid-resource",
      wallet.provider,
      showX402Progress
    );
    renderX402Result(body, settlement);
    toast("x402 payment settled; resource unlocked.", "success");
  } catch (error) {
    byId("x402-result").textContent = error.message;
    byId("x402-result").classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});
if (window.location.pathname.startsWith("/pay/")) {
  loadCheckoutPage();
} else {
  const initialView = ["#merchant", "#faq", "#console"].includes(window.location.hash)
    ? window.location.hash.slice(1)
    : "merchant";
  setView(initialView);
  if (initialView === "console") {
    void ensureAppConfig();
    void loadHealth();
    void loadAudit();
    if (authSession?.access_token) restoreCurrentPayment();
  } else if (initialView === "merchant") {
    void ensureAppConfig();
    void loadMerchantWorkspace();
  }
}
