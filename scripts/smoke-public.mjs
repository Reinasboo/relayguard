// Read-only checks. Does not sign, pay, authenticate, or change production data.
for (const path of ["/", "/wallet-provider.js", "/api/health", "/api/paid-resource", "/api/audit", "/review"]) {
  try {
    const response = await fetch(`https://relayguard.vercel.app${path}`, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    let challenge;
    if (response.status === 402 && response.headers.get("payment-required")) {
      const value = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString());
      challenge = value.accepts?.map(({ network, asset, amount, payTo }) => ({ network, asset, amount, payTo }));
    }
    let title;
    if (response.headers.get("content-type")?.includes("text/html")) {
      title = (await response.text()).match(/<title>([^<]*)<\/title>/i)?.[1];
    }
    console.log(JSON.stringify({ path, status: response.status, title, challenge }));
  } catch (error) { console.log(JSON.stringify({ path, error: error.message })); }
}
