import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "./crypto.ts";

// Single source of truth for the OAuth scope. Read = Mail.Read; compose/send
// add Mail.ReadWrite (drafts/manage) + Mail.Send.
export const GRAPH_SCOPE =
  "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send";

const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
const AZURE_TENANT = Deno.env.get("AZURE_TENANT") ?? "common";

// Refresh this many ms before expiry.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface TokenAccount {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
}

/**
 * Returns a usable Microsoft Graph access token for the account, refreshing
 * and persisting new (re-encrypted) tokens if the current one is near expiry.
 * Used by both poll-microsoft and send-mail.
 */
export async function getValidAccessToken(
  db: ReturnType<typeof createClient>,
  account: TokenAccount
): Promise<string> {
  const accessToken = await decryptToken(account.access_token_encrypted);

  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;
  if (Date.now() + REFRESH_BUFFER_MS < expiresAt) {
    return accessToken;
  }

  // Near/over expiry → refresh.
  const refreshToken = await decryptToken(account.refresh_token_encrypted);
  const res = await fetch(
    `https://login.microsoftonline.com/${AZURE_TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: GRAPH_SCOPE,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  // encryptToken throws on failure, aborting before the update so we never
  // overwrite good tokens with null.
  const encAccess = await encryptToken(tokens.access_token);
  const encRefresh = await encryptToken(tokens.refresh_token ?? refreshToken);

  await db
    .from("connected_accounts")
    .update({
      access_token_encrypted: encAccess,
      refresh_token_encrypted: encRefresh,
      token_expires_at: tokenExpiresAt,
    })
    .eq("id", account.id);

  return tokens.access_token;
}
