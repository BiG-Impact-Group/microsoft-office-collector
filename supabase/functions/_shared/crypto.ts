// Application-side token encryption for DevPod.
//
// Tokens are encrypted with AES-256-GCM (Web Crypto) before being stored,
// so the database only ever holds opaque ciphertext. The 32-byte key is
// supplied as base64 via the TOKEN_ENCRYPTION_KEY function secret and never
// touches the database.
//
// Wire format (base64 of): [12-byte IV][GCM ciphertext+tag]

const KEY_B64 = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? "";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!KEY_B64) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  }
  const raw = b64ToBytes(KEY_B64);
  if (raw.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`
    );
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return cachedKey;
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToB64(out);
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const key = await getKey();
  const data = b64ToBytes(ciphertext);
  if (data.length <= 12) {
    throw new Error("Ciphertext too short");
  }
  const iv = data.subarray(0, 12);
  const ct = data.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
