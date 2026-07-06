import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken, type TokenAccount } from "./graphToken.ts";

// Shared plumbing for the user-facing OneDrive edge functions (onedrive-list /
// -download / -process / -upload). They authenticate the caller with their JWT,
// then do Graph + DB work with the service role scoped to that user's account —
// mirroring how the crons write `documents`, but gated on the caller's identity.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export interface OneDriveAccount extends TokenAccount {
  user_id: string;
}

export interface ResolvedCaller {
  serviceDb: SupabaseClient;
  account: OneDriveAccount;
  token: string;
}

/**
 * Verifies the caller's JWT, resolves their active Microsoft account, and
 * returns a service-role client plus a valid Graph access token. On any failure
 * returns a ready-to-send error Response instead (check `"error" in result`).
 */
export async function resolveCaller(req: Request): Promise<ResolvedCaller | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: json({ error: "Missing authorization" }, 401) };
  }

  // Identity: who is calling? (anon client bound to the caller's JWT)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { error: json({ error: "Invalid session" }, 401) };
  }
  const userId = userData.user.id;

  // Work: service role, scoped to this user's active Microsoft account.
  const serviceDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: acct, error: acctErr } = await serviceDb
    .from("connected_accounts")
    .select("id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .eq("is_active", true)
    .maybeSingle();
  if (acctErr) {
    console.error("account lookup failed:", acctErr);
    return { error: json({ error: "Account lookup failed" }, 500) };
  }
  if (!acct) {
    return { error: json({ error: "No active Microsoft account connected" }, 409) };
  }

  const account = acct as OneDriveAccount;
  let token: string;
  try {
    token = await getValidAccessToken(serviceDb, account);
  } catch (err) {
    console.error("token failed:", err);
    return { error: json({ error: "Could not obtain a Microsoft access token — try reconnecting." }, 502) };
  }

  return { serviceDb, account, token };
}
