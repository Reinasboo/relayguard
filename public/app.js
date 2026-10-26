import { payForRelayguardResource } from "./x402-client.js";

const byId = (id) => document.getElementById(id);

let walletState;
let currentRecord;
let currentChallenge;
let currentHash;
let checkoutInvoice;
let checkoutAuthorization;
let checkoutWallet;
let checkoutVerificationInProgress = false;
let appConfig;
let authSession;

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

function persistAuthSession(session) {
  authSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: session.token_type
  };
  localStorage.setItem("relayguard.authSession", JSON.stringify(authSession));
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

async function api(path, options = {}) {
  const requestHeaders = () => ({
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(authSession?.access_token ? { authorization: `Bearer ${authSession.access_token}` } : {}),
    ...options.headers
  });
  let response = await fetch(path, {
    ...options,
    headers: requestHeaders()
  });
  if (
    response.status === 401 &&
    authSession?.refresh_token &&
    appConfig?.supabase &&
    path !== "/api/config"
  ) {
    const refreshed = await fetch(`${appConfig.supabase.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: appConfig.supabase.publishableKey
      },
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    if (refreshed.ok) {
      persistAuthSession(await refreshed.json());
      response = await fetch(path, { ...options, headers: requestHeaders() });
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
      note.textContent = "The one-time approval challenge is only available in the tab that created this request. Submit a fresh intent if that tab was closed.";
      actions.append(note);
    }
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
  try {
    const { body } = await api("/api/health");
    walletState = body;
    byId("network-label").textContent = body.network;
    byId("network-status").textContent = "CONNECTED";
    byId("network-status").className = "status-pill success";
    byId("native-balance").innerHTML = "";
    byId("native-balance").append(document.createTextNode(Number(body.nativeBalance).toFixed(6)));
    const unit = document.createElement("small");
    unit.textContent = ` ${body.nativeAsset}`;
    byId("native-balance").append(unit);
    byId("wallet-address").textContent = `${shortAddress(body.wallet)} · signer ready`;
    byId("wallet-address").title = body.wallet;
    byId("chain-name").textContent = body.network;
    byId("chain-id").textContent = String(body.chainId);
    byId("block-number").textContent = body.blockNumber;
    if (body.musd) {
      const amount = BigInt(body.musd.balanceAtomic);
      const decimals = BigInt(body.musd.decimals);
      const divisor = 10n ** decimals;
      const whole = amount / divisor;
      const fraction = (amount % divisor).toString().padStart(Number(decimals), "0").slice(0, 6);
      byId("musd-balance").textContent = `${whole}.${fraction}`;
      const unit = document.createElement("small");
      unit.textContent = " MUSD";
      byId("musd-balance").append(unit);
      byId("musd-contract").textContent = shortAddress(body.musd.address);
      byId("musd-contract").title = body.musd.address;
      byId("musd-card").classList.remove("hidden");
    }

    const recipientSelect = byId("recipient");
    recipientSelect.innerHTML = "";
    if (body.policy.configuredRecipients.length) {
      for (const recipient of body.policy.configuredRecipients) {
        const option = document.createElement("option");
        option.value = recipient;
        option.textContent = `${shortAddress(recipient)}${recipient.toLowerCase() === body.wallet.toLowerCase() ? " · own wallet" : ""}`;
        option.title = recipient;
        recipientSelect.append(option);
      }
      byId("setup-notice").classList.add("hidden");
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No destinations configured";
      recipientSelect.append(option);
      byId("request-button").disabled = true;
      const notice = byId("setup-notice");
      notice.classList.remove("hidden");
      notice.textContent = "Payments are paused until an approved recipient is configured.";
    }

    if (body.musd) {
      const option = document.createElement("option");
      option.value = "MUSD";
      option.textContent = "MUSD · Mezo Testnet";
      byId("asset").append(option);
      byId("amount-unit").textContent = "BTC";
      byId("asset").addEventListener("change", updateUnit);
    } else {
      const notice = byId("setup-notice");
      if (!notice.classList.contains("hidden")) {
        notice.textContent += " MUSD payments are temporarily unavailable.";
      }
    }
  } catch (error) {
    byId("network-status").textContent = "OFFLINE";
    byId("network-status").className = "status-pill danger";
    byId("network-label").textContent = "Mezo RPC unavailable";
    byId("setup-notice").classList.remove("hidden");
    console.error("Mezo network status could not be loaded:", error);
    byId("setup-notice").textContent = "Mezo network status is temporarily unavailable. Please try again.";
    toast("Mezo network status is temporarily unavailable.", "error");
  }
}

function updateUnit() {
  byId("amount-unit").textContent = byId("asset").value;
}

async function loadAudit() {
  if (!authSession?.access_token) {
    byId("audit-events").textContent = "Sign in to your merchant account to view the authorization audit.";
    return;
  }
  const { body } = await api("/api/audit");
  byId("audit-state").textContent = body.verified ? "Integrity verified" : "Integrity error";
  byId("audit-state").className = `stat-value compact ${body.verified ? "text-good" : "text-bad"}`;
  const list = byId("audit-events");
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
    meta.textContent = `${new Date(event.at).toLocaleTimeString()} · ${event.status.replaceAll("_", " ")}`;
    copy.append(title, meta);
    const sequence = document.createElement("span");
    sequence.className = "audit-sequence";
    sequence.textContent = `#${event.sequence}`;
    item.append(icon, copy, sequence);
    list.append(item);
  }
}

async function requestPayment(event) {
  event.preventDefault();
  const button = byId("request-button");
  button.disabled = true;
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
    button.disabled = false;
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
    showError(error.message);
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
byId("refresh-audit").addEventListener("click", () => loadAudit().catch((error) => toast(error.message, "error")));

function setView(view) {
  const isPayPage = window.location.pathname.startsWith("/pay/");
  byId("console-view").classList.toggle("hidden", isPayPage || view !== "console");
  byId("merchant-view").classList.toggle("hidden", isPayPage || view !== "merchant");
  byId("checkout-view").classList.toggle("hidden", !isPayPage);
  document.querySelectorAll(".rail-link[data-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === view && !isPayPage);
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

async function loadMerchantWorkspace() {
  try {
    const { body: merchantBody } = await api("/api/merchant");
    byId("merchant-name").textContent = merchantBody.name;
    byId("merchant-address").textContent = merchantBody.address
      ? `${shortAddress(merchantBody.address)} · MUSD payments`
      : "Merchant receiving wallet unavailable";
    if (!authSession?.access_token) {
      byId("invoice-button").disabled = true;
      byId("invoice-list").textContent = "Sign in with Supabase to view your merchant invoices.";
      return;
    }
    const { body: invoiceBody } = await api("/api/invoices");
    byId("invoice-button").disabled = !merchantBody.address;
    renderInvoiceList(invoiceBody.invoices);
  } catch (error) {
    console.error("Merchant workspace could not be loaded:", error);
    byId("invoice-list").textContent = "Invoices could not be loaded. Please refresh and try again.";
  }
}

function renderAuthState(message) {
  const target = byId("auth-state");
  const signedIn = Boolean(authSession?.access_token);
  target.textContent = message ?? (signedIn
    ? "Account connected. Merchant invoice management is active."
    : appConfig?.supabase
      ? "Sign in or create a merchant account to manage invoices."
      : "Merchant account access is temporarily unavailable. Please try again later.");
  target.className = `notice${signedIn && !message ? " auth-connected" : ""}`;
  byId("auth-signout").classList.toggle("hidden", !signedIn);
  byId("auth-signup").classList.toggle("hidden", signedIn || !appConfig?.supabase);
  byId("merchant-auth-form").classList.toggle("hidden", signedIn || !appConfig?.supabase);
}

async function loadAppConfig() {
  try {
    appConfig = (await api("/api/config")).body;
    renderAuthState();
    if (!appConfig.supabase && authSession) {
      authSession = undefined;
      localStorage.removeItem("relayguard.authSession");
    }
    byId("x402-endpoint").textContent = new URL(appConfig.x402.endpoint, window.location.origin).pathname;
    byId("x402-price").textContent = appConfig.x402.enabled
      ? `${appConfig.x402.price} MUSD · Mezo Testnet`
      : "x402 disabled";
    byId("pay-x402-resource").disabled = !appConfig.x402.enabled;
    if (!appConfig.x402.enabled) {
      byId("x402-result").textContent = "Enable X402_ENABLED and set X402_PAY_TO to use the paid API resource.";
      byId("x402-result").classList.remove("hidden");
    }
  } catch (error) {
    console.error("Application configuration could not be loaded:", error);
    renderAuthState("Merchant services are temporarily unavailable. Please refresh and try again.");
    byId("pay-x402-resource").disabled = true;
    byId("x402-price").textContent = "Configuration unavailable";
  }
}

async function submitMerchantAuth(event) {
  event.preventDefault();
  if (!appConfig?.supabase) return;
  const email = byId("auth-email").value.trim();
  const password = byId("auth-password").value;
  const isSignup = event.submitter?.id === "auth-signup";
  const endpoint = isSignup
    ? `${appConfig.supabase.url}/auth/v1/signup`
    : `${appConfig.supabase.url}/auth/v1/token?grant_type=password`;
  try {
    const response = await fetch(endpoint, {
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
      await loadMerchantWorkspace();
      await loadAudit().catch((error) => console.error("Audit refresh failed:", error));
      toast("Merchant account connected.", "success");
    } else {
      renderAuthState("Account created. Check your email to verify it, then sign in.");
    }
  } catch (error) {
    renderAuthState(error.message);
  }
}

async function signOutMerchant() {
  if (authSession?.access_token && appConfig?.supabase) {
    await fetch(`${appConfig.supabase.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authSession.access_token}`,
        apikey: appConfig.supabase.publishableKey
      }
    }).catch((error) => console.warn("Supabase sign-out request failed:", error));
  }
  authSession = undefined;
  localStorage.removeItem("relayguard.authSession");
  renderAuthState();
  await loadMerchantWorkspace();
}

function renderInvoiceList(invoices) {
  const list = byId("invoice-list");
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
  button.disabled = true;
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
    qr.src = body.qrUrl;
    qr.alt = "QR code for the newly created MUSD invoice";
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
    display.append(qr, details);
    renderInvoiceList([body.invoice, ...(await api("/api/invoices")).body.invoices.filter((item) => item.id !== body.invoice.id)]);
    toast("MUSD checkout invoice created.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function loadCheckoutPage() {
  setView("checkout");
  const invoiceId = decodeURIComponent(window.location.pathname.slice("/pay/".length));
  try {
    const [{ body: invoiceBody }, { body: merchantBody }] = await Promise.all([
      api(`/api/invoices/${encodeURIComponent(invoiceId)}`),
      api("/api/merchant")
    ]);
    checkoutInvoice = invoiceBody.invoice;
    byId("checkout-loading").classList.add("hidden");
    byId("checkout-content").classList.remove("hidden");
    byId("checkout-merchant-name").textContent = checkoutInvoice.merchantName;
    byId("checkout-amount").textContent = `${formatAtomic(checkoutInvoice.amountAtomic)} MUSD`;
    byId("checkout-description").textContent = checkoutInvoice.description;
    byId("checkout-merchant-address").textContent = shortAddress(checkoutInvoice.merchantAddress);
    byId("checkout-merchant-address").title = checkoutInvoice.merchantAddress;
    byId("checkout-expiry").textContent = new Date(checkoutInvoice.expiresAt).toLocaleString();
    byId("checkout-qr").src = `/api/invoices/${encodeURIComponent(invoiceId)}/qr`;
    const status = byId("checkout-state-tag");
    status.textContent = checkoutInvoice.status === "paid"
      ? "PAYMENT CONFIRMED"
      : checkoutInvoice.status === "expired"
        ? "INVOICE EXPIRED"
        : checkoutInvoice.status === "failed"
          ? "PAYMENT FAILED"
          : checkoutInvoice.status === "submitted"
            ? "VERIFYING PAYMENT"
            : "AWAITING PAYMENT";
    status.className = `verified-tag checkout-status ${checkoutInvoice.status === "paid" ? "success" : checkoutInvoice.status === "failed" || checkoutInvoice.status === "expired" ? "danger" : ""}`;
    if (checkoutInvoice.status !== "open") {
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
      byId("checkout-qr").parentElement.classList.add("hidden");
      if (checkoutInvoice.status === "paid") {
        setCheckoutMessage("Payment confirmed on Mezo.", "success-message");
        byId("checkout-result").classList.remove("hidden");
      }
    }
    byId("connect-pay-button").addEventListener("click", () => {
      if (checkoutInvoice.status === "submitted") {
        void pollCheckoutInvoice();
      } else if (checkoutInvoice.status === "open") {
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
    byId("checkout-loading").innerHTML = "";
    const message = document.createElement("strong");
    message.textContent = error.message;
    byId("checkout-loading").append(message);
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
}

function setCheckoutMessage(message, kind = "notice") {
  const target = byId("checkout-result");
  target.className = kind;
  target.textContent = message;
}

function markCheckoutPaid(transactionHash) {
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
  const transactionHash = checkoutInvoice.transactionReference;
  let attempt = 0;
  try {
    while (checkoutInvoice.status === "submitted") {
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
        byId("checkout-wallet-state").textContent = attempt < 20
          ? `Payment submitted. Waiting for Mezo confirmation (${attempt + 1}/20)…`
          : "Payment submitted. Still checking Mezo for confirmation; do not pay again.";
      } catch (error) {
        if (error.status && error.status < 500 && error.status !== 429) {
          byId("checkout-wallet-state").textContent = `Could not verify this invoice (HTTP ${error.status}): ${error.message}`;
          setCheckoutMessage("The transaction was submitted. Do not pay again; contact the merchant if this persists.", "error");
          byId("checkout-result").classList.remove("hidden");
          return;
        }
        byId("checkout-wallet-state").textContent = `Verification temporarily unavailable; retrying automatically. Do not pay again. ${error.message}`;
      }
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 20 ? 750 : 2500));
      attempt += 1;
    }
  } finally {
    checkoutVerificationInProgress = false;
    if (checkoutInvoice?.status === "submitted") {
      button.disabled = false;
      button.textContent = "Check payment status";
    }
  }
}

async function payCheckout() {
  const provider = window.ethereum;
  if (!provider) {
    setCheckoutMessage("Install or open an EVM wallet such as MetaMask, then reopen this checkout.", "notice");
    byId("checkout-result").classList.remove("hidden");
    return;
  }
  const button = byId("connect-pay-button");
  button.disabled = true;
  checkoutAuthorization = undefined;
  let broadcastHash;
  try {
    await ensureMezoWallet(provider);
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    checkoutWallet = accounts[0];
    if (!checkoutWallet) throw new Error("Wallet did not return an account.");
    byId("checkout-wallet-state").textContent = `Connected ${shortAddress(checkoutWallet)} · requesting exact MUSD payment authorization…`;
    const { body: authorizedBody } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/authorize`, {
      method: "POST",
      body: JSON.stringify({ payerAddress: checkoutWallet })
    });
    checkoutAuthorization = authorizedBody.authorization;
    const token = await api("/api/merchant");
    const amountHex = BigInt(checkoutInvoice.amountAtomic).toString(16).padStart(64, "0");
    const addressHex = checkoutInvoice.merchantAddress.slice(2).toLowerCase().padStart(64, "0");
    const data = `0xa9059cbb${addressHex}${amountHex}`;
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
    const { body: submittedBody } = await api(`/api/invoices/${encodeURIComponent(checkoutInvoice.id)}/submit`, {
      method: "POST",
      body: JSON.stringify({
        authorizationId: checkoutAuthorization.id,
        transactionHash
      })
    });
    checkoutInvoice = submittedBody.invoice;
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
    button.disabled = checkoutInvoice?.status !== "open";
  }
}

document.querySelectorAll(".rail-link[data-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const view = link.dataset.view;
    if (view === "merchant") {
      history.replaceState(null, "", "/#merchant");
      setView("merchant");
      loadMerchantWorkspace();
    } else {
      history.replaceState(null, "", "/");
      setView("console");
    }
  });
});
byId("invoice-form").addEventListener("submit", createInvoice);
byId("refresh-invoices").addEventListener("click", loadMerchantWorkspace);
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
    const { body, settlement } = await payForRelayguardResource(
      "/api/paid-resource",
      (message) => {
        byId("x402-result").textContent = message;
        byId("x402-result").classList.remove("hidden");
      }
    );
    byId("x402-result").textContent = `${JSON.stringify(body, null, 2)}\n\nMezo settlement: ${settlement}`;
    byId("x402-result").classList.remove("hidden");
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
  loadAppConfig();
  setView(window.location.hash === "#merchant" ? "merchant" : "console");
  loadHealth();
  if (authSession?.access_token) {
    loadAudit().catch((error) => console.error("Audit initialization failed:", error));
    restoreCurrentPayment();
  }
  if (window.location.hash === "#merchant") loadMerchantWorkspace();
}
