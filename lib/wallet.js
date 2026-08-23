import { base58Encode, base64ToBytes, bytesToBase64 } from "./encoding.js";

export const WALLET_FORMAT_VERSION = 1;

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("This browser does not provide the Web Crypto APIs required for wallet generation");
  }
  return globalThis.crypto;
}

function extractEd25519Seed(pkcs8Bytes) {
  if (!(pkcs8Bytes instanceof Uint8Array) || pkcs8Bytes.length < 32) {
    throw new Error("The browser returned an invalid Ed25519 private key");
  }
  // RFC 8410 encodes the private seed as an inner 32-byte OCTET STRING.
  for (let index = 0; index <= pkcs8Bytes.length - 36; index += 1) {
    if (
      pkcs8Bytes[index] === 0x04 &&
      pkcs8Bytes[index + 1] === 0x22 &&
      pkcs8Bytes[index + 2] === 0x04 &&
      pkcs8Bytes[index + 3] === 0x20
    ) {
      return pkcs8Bytes.slice(index + 4, index + 36);
    }
  }
  throw new Error("The browser returned an unsupported Ed25519 PKCS#8 structure");
}

export async function generateSolanaWallet(now = Date.now()) {
  const cryptoApi = requireCrypto();
  const keyPair = await cryptoApi.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const [rawPublic, privatePkcs8] = await Promise.all([
    cryptoApi.subtle.exportKey("raw", keyPair.publicKey),
    cryptoApi.subtle.exportKey("pkcs8", keyPair.privateKey)
  ]);
  const publicBytes = new Uint8Array(rawPublic);
  const seed = extractEd25519Seed(new Uint8Array(privatePkcs8));
  if (publicBytes.length !== 32 || seed.length !== 32) {
    throw new Error("The browser returned an unsupported Ed25519 key format");
  }

  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(publicBytes, 32);
  return {
    formatVersion: WALLET_FORMAT_VERSION,
    network: "solana",
    publicKey: base58Encode(publicBytes),
    secretKeyBase64: bytesToBase64(secretKey),
    createdAt: now
  };
}

export function publicWalletRecord(wallet) {
  if (!wallet?.publicKey) return null;
  return {
    formatVersion: Number(wallet.formatVersion || WALLET_FORMAT_VERSION),
    network: "solana",
    publicKey: String(wallet.publicKey),
    createdAt: Number(wallet.createdAt || 0)
  };
}

export function exportSolanaWallet(wallet) {
  if (!wallet?.secretKeyBase64 || !wallet?.publicKey) throw new Error("Wallet is not available");
  const secretKey = base64ToBytes(wallet.secretKeyBase64);
  if (secretKey.length !== 64) throw new Error("Stored wallet has an invalid private key length");
  const publicKey = base58Encode(secretKey.slice(32));
  if (publicKey !== wallet.publicKey) throw new Error("Stored wallet key material failed validation");
  return {
    publicKey,
    privateKeyBase58: base58Encode(secretKey),
    keypair: [...secretKey]
  };
}
