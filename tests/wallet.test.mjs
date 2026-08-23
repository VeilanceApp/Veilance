import test from "node:test";
import assert from "node:assert/strict";

import { base58Encode, base64ToBytes } from "../lib/encoding.js";
import { exportSolanaWallet, generateSolanaWallet, publicWalletRecord } from "../lib/wallet.js";

test("base58 encoding preserves leading zero bytes", () => {
  assert.equal(base58Encode(new Uint8Array([0])), "1");
  assert.equal(base58Encode(new Uint8Array([0, 0, 1])), "112");
  assert.equal(base58Encode(new Uint8Array(32)), "1".repeat(32));
});

test("wallet generation produces a standard 32-byte address and 64-byte Solana keypair", async () => {
  const wallet = await generateSolanaWallet(12345);
  const secret = base64ToBytes(wallet.secretKeyBase64);
  assert.equal(secret.length, 64);
  assert.equal(wallet.publicKey, base58Encode(secret.slice(32)));
  assert.equal(wallet.createdAt, 12345);

  const exported = exportSolanaWallet(wallet);
  assert.equal(exported.publicKey, wallet.publicKey);
  assert.equal(exported.keypair.length, 64);
  assert.equal(exported.privateKeyBase58, base58Encode(secret));
});

test("public wallet responses never contain private key material", async () => {
  const wallet = await generateSolanaWallet();
  const publicRecord = publicWalletRecord(wallet);
  assert.equal(publicRecord.publicKey, wallet.publicKey);
  assert.equal("secretKeyBase64" in publicRecord, false);
  assert.equal(JSON.stringify(publicRecord).includes(wallet.secretKeyBase64), false);
});
