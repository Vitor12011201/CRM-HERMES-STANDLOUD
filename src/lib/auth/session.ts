export const sessionCookieName = "standloud_session";
export const sessionDurationMs = 12 * 60 * 60 * 1000;

type SessionPayload = {
  exp: number;
};

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hasMatchingBytes(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

async function sign(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(signature);
}

export function hasValidAdminPassword(password: string, expectedPassword: string | undefined) {
  if (!expectedPassword) return false;
  return hasMatchingBytes(new TextEncoder().encode(password), new TextEncoder().encode(expectedPassword));
}

export async function createSessionToken(
  sessionSecret: string,
  options: { now?: number; durationMs?: number } = {},
) {
  const now = options.now ?? Date.now();
  const payload: SessionPayload = { exp: now + (options.durationMs ?? sessionDurationMs) };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signedValue = `v1.${encodedPayload}`;
  const signature = toBase64Url(await sign(signedValue, sessionSecret));
  return `${signedValue}.${signature}`;
}

export async function hasValidSessionToken(
  token: string | undefined,
  sessionSecret: string | undefined,
  now = Date.now(),
) {
  if (!token || !sessionSecret) return false;

  const [version, encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (version !== "v1" || !encodedPayload || !encodedSignature || extra.length > 0) return false;

  try {
    const expectedSignature = await sign(`${version}.${encodedPayload}`, sessionSecret);
    const receivedSignature = fromBase64Url(encodedSignature);
    if (!hasMatchingBytes(receivedSignature, expectedSignature)) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionPayload;
    return Number.isSafeInteger(payload.exp) && payload.exp > now;
  } catch {
    return false;
  }
}
