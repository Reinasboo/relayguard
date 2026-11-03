import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletChoices,
  selectSingleWallet
} from "../public/wallet-provider.js";

test("requires a wallet choice when multiple wallets are available", () => {
  const metamask = { request() {}, isMetaMask: true };
  const rainbow = { request() {}, isRainbow: true };

  assert.equal(
    selectSingleWallet([
      { name: "MetaMask", provider: metamask },
      { name: "Rainbow", provider: rainbow }
    ]),
    undefined
  );
});

test("requires a wallet choice when multiple other wallets are available", () => {
  const rainbow = { request() {}, isRainbow: true };
  const other = { request() {} };

  assert.equal(
    selectSingleWallet([
      { name: "Rainbow", provider: rainbow },
      { name: "Injected wallet 2", provider: other }
    ]),
    undefined
  );
});

test("uses a single available wallet", () => {
  const provider = { request() {} };
  assert.deepEqual(
    selectSingleWallet([{ name: "Injected wallet 1", provider }]),
    { name: "Injected wallet 1", provider }
  );
});

test("combines announced and legacy wallets without duplicates", () => {
  const metamask = { request() {}, isMetaMask: true };
  const rainbow = { request() {}, isRainbow: true };
  const coinbase = { request() {}, isCoinbaseWallet: true };

  const wallets = createWalletChoices(
    new Map([
      [metamask, "MetaMask"],
      [rainbow, "Rainbow"]
    ]),
    { providers: [metamask, rainbow, coinbase] }
  );

  assert.deepEqual(wallets.map((wallet) => wallet.name), [
    "MetaMask",
    "Rainbow",
    "Coinbase Wallet"
  ]);
  assert.deepEqual(wallets.map((wallet) => wallet.provider), [
    metamask,
    rainbow,
    coinbase
  ]);
});
