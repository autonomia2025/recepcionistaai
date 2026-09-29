// Signed OAuth "state" (HMAC-SHA256) and a safe return URL for the redirect
// after connecting an account. No Deno-only APIs (unit-tested).

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))));
}

export interface StatePayload {
  userId: string;
  workshopId: string;
  returnTo: string;
  issuedAt: number;
  nonce: string;
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(
  state: string | null,
  secret: string,
  maxAgeMs = 15 * 60 * 1000,
  now = Date.now(),
): Promise<StatePayload | null> {
  if (!state || !secret) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body)) as StatePayload;
    if (typeof payload.issuedAt !== 'number' || now - payload.issuedAt > maxAgeMs || payload.issuedAt - now > 60_000) return null;
    if (!payload.userId || !payload.workshopId || typeof payload.returnTo !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

// Only send people back to the app itself (never to an arbitrary site).
export function safeReturnUrl(candidate: string | null | undefined, appUrl: string, path = '/my-day'): string {
  const fallback = `${appUrl.replace(/\/$/, '')}${path}`;
  if (!candidate) return fallback;
  let url: URL;
  try { url = new URL(candidate); } catch { return fallback; }
  const host = url.hostname;
  const allowed =
    url.origin === new URL(appUrl).origin ||
    (url.protocol === 'https:' && (host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com'))) ||
    (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1'));
  return allowed ? `${url.origin}${path}` : fallback;
}
