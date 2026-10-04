import { createHash, randomBytes } from 'crypto';
import { createServer } from 'http';

export interface GoogleClient { clientId: string; clientSecret?: string }
export interface GoogleTokens { accessToken: string; refreshToken: string; expiresAt: number }
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.metadata.readonly'];

export function parseGoogleClient(raw: unknown): GoogleClient {
  const value = raw as { installed?: { client_id?: unknown; client_secret?: unknown } };
  const installed = value?.installed;
  if (!installed || typeof installed.client_id !== 'string' || installed.client_id.length > 300 || !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(installed.client_id)) throw new Error('Select a Google OAuth client JSON file with application type Desktop app.');
  if (installed.client_secret !== undefined && typeof installed.client_secret !== 'string') throw new Error('The OAuth client secret must be a string.');
  return { clientId: installed.client_id, ...(installed.client_secret ? { clientSecret: String(installed.client_secret) } : {}) };
}

async function tokenRequest(params: Record<string, string>, request: typeof fetch): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Google could not authorize this connection. Check the OAuth application configuration or sign in again.');
  const data = await response.json();
  if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Google returned an incomplete token response.');
  return data;
}

export async function refreshGoogleTokens(client: GoogleClient, tokens: GoogleTokens, request: typeof fetch = fetch): Promise<GoogleTokens> {
  if (tokens.expiresAt > Date.now() + 60000) return tokens;
  const result = await tokenRequest({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }, request);
  return { accessToken: result.access_token, refreshToken: result.refresh_token || tokens.refreshToken, expiresAt: Date.now() + result.expires_in * 1000 };
}

/** System-browser sign-in with PKCE, a random loopback port and state validation. */
export async function authorizeGoogle(client: GoogleClient, openBrowser: (url: string) => Promise<boolean>, signal?: AbortSignal, request: typeof fetch = fetch): Promise<GoogleTokens> {
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const server = createServer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: Error) => void = () => undefined;
  const aborted = () => fail(new Error('Google sign-in was cancelled.'));
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the Google sign-in callback.');
    const redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
    const code = new Promise<string>((resolve, reject) => {
      fail = reject;
      server.on('request', (req, res) => {
        let url: URL;
        try { url = new URL(req.url || '/', redirect); }
        catch { res.writeHead(400); res.end(); return; }
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
        if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid sign-in state.'); return; }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (url.searchParams.has('error') || !url.searchParams.get('code')) { res.end('Sign-in was cancelled. Return to VS Code.'); reject(new Error('Google sign-in was denied or cancelled.')); return; }
        res.end('Google sign-in received. Return to VS Code to choose your spreadsheet.');
        resolve(url.searchParams.get('code')!);
      });
      timer = setTimeout(() => reject(new Error('Google sign-in timed out. Try again.')), 120000);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' }).toString();
      openBrowser(auth.toString()).then(opened => { if (!opened) reject(new Error('Could not open Google sign-in in your browser.')); }, () => reject(new Error('Could not open Google sign-in in your browser.')));
    });
    const result = await tokenRequest({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), code: await code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }, request);
    if (signal?.aborted) throw new Error('Google sign-in was cancelled.');
    if (!result.refresh_token) throw new Error('Google did not return offline access. Reconnect and approve the requested access.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000 };
  } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', aborted); server.close(); }
}

export async function googleSpreadsheets(tokens: GoogleTokens, request: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  const files: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", fields: 'nextPageToken,files(id,name)', pageSize: '100', orderBy: 'modifiedTime desc', ...(pageToken ? { pageToken } : {}) }).toString();
    const response = await request(url.toString(), { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Could not list spreadsheets. Enable Google Drive API and approve spreadsheet access, then sign in again.');
    const result = await response.json();
    files.push(...(result.files || []).filter((file: any) => typeof file.id === 'string' && typeof file.name === 'string'));
    pageToken = result.nextPageToken;
  } while (pageToken && files.length < 1000);
  return files;
}

export function googleConnection(id: string, client: GoogleClient, tokens: GoogleTokens): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid spreadsheet selection.');
  const credentials = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, oauthClientId: client.clientId, ...(client.clientSecret ? { oauthClientSecret: client.clientSecret } : {}), tokenExpiresAt: String(tokens.expiresAt) };
  return `googlesheets://${id};${Object.entries(credentials).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join(';')}`;
}
