import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/review-server.mjs"], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
let browser;
const output = resolve("output/review");
await mkdir(output, { recursive: true });
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${origin}/review`)).ok) break; } catch { /* wait for startup */ }
    if (i === 79) throw new Error("Review server did not start.");
    await new Promise((done) => setTimeout(done, 250));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    recordVideo: { dir: `${output}/recordings`, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/review`, { waitUntil: "domcontentloaded" });
  await page.getByText("Within spending policy", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/01-review-desktop.png`, fullPage: true });
  await page.waitForTimeout(2500);
  await page.locator("#proof").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.getElementById("refresh-evidence").disabled, null, { timeout: 45_000 });
  await page.screenshot({ path: `${output}/02-mezo-evidence.png` });
  await writeFile(`${output}/live-evidence.json`, await page.locator("#raw-evidence").textContent());
  await page.waitForTimeout(3000);
  const cases = [["healthy", "Within spending policy"], ["review", "Human approval required"], ["blocked", "Payment blocked"], ["unavailable", "MUSD spending paused"]];
  for (const [scenario, title] of cases) {
    await page.locator(`#policy`).scrollIntoViewIfNeeded();
    await page.locator(`[data-scenario="${scenario}"]`).click();
    await page.getByText(title, { exact: true }).waitFor();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${output}/policy-${scenario}.png` });
  }
  await page.locator('[data-scenario="healthy"]').click();
  await page.locator("#preview-amount").fill("26");
  await page.locator("#run-policy").click();
  await page.getByText("This payment exceeds the 25 MUSD per-payment limit.", { exact: true }).waitFor();
  await page.locator("#preview-amount").fill("1.00"); await page.locator("#run-policy").click();
  await page.getByText("Within spending policy", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/03-policy-lab.png` });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/review`, { waitUntil: "domcontentloaded" });
    await page.getByText("Within spending policy", { exact: true }).waitFor();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    if (!fits) throw new Error(`Horizontal overflow at viewport ${width}`);
    await page.screenshot({ path: `${output}/responsive-${width}.png`, fullPage: true });
  }
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  if (!await page.locator("#merchant-view").isVisible()) throw new Error("Merchant must be the default workspace.");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(", ")}`);
  const denied = await fetch(`${origin}/api/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (denied.status !== 403) throw new Error("Review-only server allowed a payment mutation.");
  await context.close();
  // A separate, unrecorded UI regression: a reload after broadcast must recover
  // the existing hash, never ask the wallet to send another payment.
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  const hash = `0x${"a".repeat(64)}`;
  const invoice = { id: "recovery-fixture", merchantName: "UI test fixture", merchantAddress: "0x840E5bBF20D725f581752f8A4021ADd730550d47",
    amountAtomic: "1000000000000000000", description: "Recovery regression", status: "authorized", expiresAt: Date.now()+60_000 };
  let recoveredSubmissions = 0;
  await recoveryPage.addInitScript(({ hash }) => {
    window.walletCalls = 0;
    window.ethereum = { request() { window.walletCalls++; throw new Error("A recovery must not request a wallet transfer"); } };
    sessionStorage.setItem("relayguard.broadcast:recovery-fixture", JSON.stringify({ authorizationId: "fixture-auth", checkoutToken: "fixture-capability", transactionHash: hash }));
  }, { hash });
  await recoveryPage.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/submit")) {
      const body = route.request().postDataJSON();
      if (body.checkoutToken !== "fixture-capability" || body.transactionHash !== hash) throw new Error("Incorrect broadcast recovery payload");
      recoveredSubmissions++;
      await route.fulfill({ json: { invoice: { ...invoice, status: "submitted", transactionReference: hash } } });
    } else if (url.pathname.endsWith("/verify")) {
      await route.fulfill({ json: { invoice: { ...invoice, status: "paid", transactionReference: hash } } });
    } else if (url.pathname === "/api/merchant") {
      await route.fulfill({ json: { tokenAddress: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" } });
    } else if (url.pathname === "/api/invoices/recovery-fixture") {
      await route.fulfill({ json: { invoice } });
    } else await route.fulfill({ status: 404, json: { error: "Not part of this fixture" } });
  });
  await recoveryPage.goto(`${origin}/pay/recovery-fixture`);
  await recoveryPage.getByText("PAYMENT CONFIRMED", { exact: true }).waitFor();
  if (recoveredSubmissions !== 1 || await recoveryPage.evaluate(() => window.walletCalls) !== 0) throw new Error("Broadcast recovery requested a duplicate payment");
  await recoveryContext.close();
  await writeFile(`${output}/ui-results.json`, JSON.stringify({ passed: true, viewports: [390, 768, 1440], policyScenarios: 4,
    amountCap: true, defaultWorkspace: "merchant", reviewMutationsDenied: true, broadcastReloadRecovery: true, pageErrors: errors }, null, 2));
  console.log(`Browser checks passed. Screenshots and a recorded local walkthrough: ${output}`);
} finally { await browser?.close(); server.kill(); }
