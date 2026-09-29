// Microsoft identity platform + Graph (v1.0) for the sellers' Outlook /
// Microsoft 365 mailboxes. App secrets: MS_CLIENT_ID, MS_CLIENT_SECRET.
// Every Graph call asks for immutable IDs, so a message keeps its id when a
// draft is sent and moves to Sent Items.

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export const MS_SCOPES = 'openid email offline_access User.Read Mail.ReadWrite Mail.Send';

export const redirectUri = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/outlook-callback`;

export function authorizeUrl(state: string): string {
  const url = new URL(`${LOGIN}/authorize`);
  url.searchParams.set('client_id', Deno.env.get('MS_CLIENT_ID') ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', MS_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(params: Record<string, string>): Promise<{ tokens: TokenSet | null; error: string | null }> {
  const response = await fetch(`${LOGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('MS_CLIENT_SECRET') ?? '',
      scope: MS_SCOPES,
      ...params,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return { tokens: null, error: data.error ?? `HTTP ${response.status}` };
  return { tokens: data as TokenSet, error: null };
}

export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

export async function graph<T = Record<string, unknown>>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Prefer: 'IdType="ImmutableId"',
    ...init.headers,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const url = path.startsWith('https://') ? path : `${GRAPH}${path}`;
  const response = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new GraphError(response.status, data?.error?.code ?? 'error', data?.error?.message ?? `Graph HTTP ${response.status}`);
  }
  if (init.raw) return new Uint8Array(await response.arrayBuffer()) as unknown as T;
  if (response.status === 202 || response.status === 204) return {} as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export interface MailboxRow {
  user_id: string;
  workshop_id: string;
  email: string;
  access_token: string | null;
  refresh_token: string;
  token_expires_at: string | null;
  inbox_synced_until: string | null;
  sent_synced_until: string | null;
}

export class MailboxDisconnectedError extends Error {}

// A valid access token, refreshed (and persisted, since refresh tokens rotate)
// when it expires in the next two minutes.
// deno-lint-ignore no-explicit-any
export async function accessTokenFor(supabase: any, mailbox: MailboxRow): Promise<string> {
  const expires = mailbox.token_expires_at ? new Date(mailbox.token_expires_at).getTime() : 0;
  if (mailbox.access_token && expires - Date.now() > 120_000) return mailbox.access_token;

  const { tokens, error } = await refreshTokens(mailbox.refresh_token);
  if (!tokens) {
    const expired = error === 'invalid_grant' || error === 'interaction_required';
    await supabase.from('staff_mailboxes').update({
      status: 'error',
      last_error: expired ? 'La conexión con Outlook expiró. Vuelve a conectar tu correo.' : `No se pudo renovar el acceso (${error}).`,
    }).eq('user_id', mailbox.user_id);
    throw new MailboxDisconnectedError(error ?? 'refresh_failed');
  }
  const update = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? mailbox.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  await supabase.from('staff_mailboxes').update(update).eq('user_id', mailbox.user_id);
  Object.assign(mailbox, update);
  return tokens.access_token;
}
