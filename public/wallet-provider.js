const announcedProviders = new Map();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail;
    if (detail?.provider && typeof detail.provider.request === "function") {
      announcedProviders.set(detail.provider, detail.info?.name || "Injected wallet");
    }
  });
}

function providerName(provider, announcedName, index) {
  if (announcedName) return announcedName;
  if (provider.isMetaMask && !provider.isRainbow) return "MetaMask";
  if (provider.isRainbow) return "Rainbow";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  return `Injected wallet ${index + 1}`;
}

export function selectSingleWallet(wallets) {
  return wallets.length === 1 ? wallets[0] : undefined;
}

export function createWalletChoices(announcements, injected) {
  const wallets = [];
  const addWallet = (provider, name) => {
    if (!provider || typeof provider.request !== "function" ||
        wallets.some((wallet) => wallet.provider === provider)) return;
    wallets.push({
      name: providerName(provider, name || announcedProviders.get(provider), wallets.length),
      provider
    });
  };

  for (const [provider, name] of announcements) addWallet(provider, name);

  const legacyProviders = Array.isArray(injected?.providers)
    ? injected.providers
    : injected ? [injected] : [];
  for (const provider of legacyProviders) addWallet(provider);

  return wallets;
}

export async function discoverWalletProviders(timeoutMs = 180) {
  if (typeof window === "undefined") return [];

  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
  return createWalletChoices(announcedProviders, window.ethereum);
}
