// Public organizer page only. No account, form submission, or authenticated data.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ timezoneId: "Africa/Lagos" });
  await page.goto("https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  await mkdir("output/research", { recursive: true });
  await writeFile("output/research/akindo-public.txt", body);
  await page.screenshot({ path: "output/research/akindo-timeline-lagos.png" });
  console.log(JSON.stringify({ timezone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    timeline: body.slice(0, body.indexOf("Builders")), requirements: body.slice(body.indexOf("Submission Requirements"), body.indexOf("How to Get Started")) }, null, 2));
} finally { await browser.close(); }
