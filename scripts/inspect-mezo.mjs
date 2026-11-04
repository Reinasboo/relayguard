const hashes = [
  "0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868",
  "0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c"
];
for (const hash of hashes) {
  try {
    const response = await fetch("https://rpc.test.mezo.org", { method: "POST",
      headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }) });
    const { result, error } = await response.json();
    console.log(JSON.stringify({ hash, error, status: result?.status, from: result?.from, to: result?.to,
      blockNumber: result?.blockNumber, logs: result?.logs.filter((log) =>
        log.address.toLowerCase() === "0x118917a40faf1cd7a13db0ef56c86de7973ac503") }));
  } catch (error) { console.log(error.message); }
}
